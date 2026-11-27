import type { TaskItem, TaskSchedulerContext } from '@lobechat/types';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { createTaskSchedulerModule } from '@/server/services/taskScheduler';

const log = debug('task-heartbeat-bootstrap');

const TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed']);

export const isTerminalTaskStatus = (status: string) => TERMINAL_STATUSES.has(status);

export const HEARTBEAT_FAILURE_FUSE = 3;

export type HeartbeatRearmReason = 'bootstrap' | 'done' | 'error';

export interface HeartbeatScheduleDeps {
  db: LobeChatDatabase;
  userId: string;
}

export interface HeartbeatRearmOptions {
  reason?: HeartbeatRearmReason;
}

const isHeartbeatActive = (
  task: Pick<TaskItem, 'automationMode' | 'heartbeatInterval' | 'status'>,
): boolean =>
  task.automationMode === 'heartbeat' &&
  !!task.heartbeatInterval &&
  task.heartbeatInterval > 0 &&
  !isTerminalTaskStatus(task.status);

export const shouldBootstrapHeartbeatOnConfigChange = (
  previous: Pick<TaskItem, 'automationMode' | 'heartbeatInterval'> | null | undefined,
  next: Pick<TaskItem, 'automationMode' | 'heartbeatInterval' | 'status'>,
): boolean => {
  if (!isHeartbeatActive(next)) return false;
  if (!previous) return true;

  const prevInterval = previous.heartbeatInterval ?? 0;
  const nextInterval = next.heartbeatInterval ?? 0;

  return previous.automationMode !== 'heartbeat' || prevInterval !== nextInterval;
};

export const shouldCancelHeartbeatOnConfigChange = (
  previous: Pick<TaskItem, 'automationMode' | 'heartbeatInterval'> | null | undefined,
  next: Pick<TaskItem, 'automationMode' | 'heartbeatInterval' | 'status'>,
): boolean => {
  if (!previous) return false;

  const wasHeartbeat =
    previous.automationMode === 'heartbeat' &&
    !!previous.heartbeatInterval &&
    previous.heartbeatInterval > 0;

  return wasHeartbeat && !isHeartbeatActive(next);
};

export const cancelHeartbeatSchedule = async (
  deps: HeartbeatScheduleDeps,
  task: TaskItem,
): Promise<void> => {
  const ctx = (task.context as { scheduler?: TaskSchedulerContext } | null) ?? {};
  const sched = ctx.scheduler ?? {};
  const scheduler = createTaskSchedulerModule();

  if (sched.tickMessageId) {
    await scheduler.cancelScheduled(sched.tickMessageId).catch(() => undefined);
  }

  await new TaskModel(deps.db, deps.userId).updateContext(task.id, {
    scheduler: {
      consecutiveFailures: sched.consecutiveFailures ?? 0,
      scheduledAt: null,
      tickMessageId: null,
    },
  });

  log('cancelled heartbeat schedule for task=%s', task.identifier);
};

export const scheduleHeartbeatTick = async (
  deps: HeartbeatScheduleDeps,
  task: TaskItem,
  options: HeartbeatRearmOptions = {},
): Promise<boolean> => {
  if (!isHeartbeatActive(task)) return false;

  const reason = options.reason ?? 'bootstrap';
  const briefModel = new BriefModel(deps.db, deps.userId);
  const taskModel = new TaskModel(deps.db, deps.userId);

  const ctx = (task.context as { scheduler?: TaskSchedulerContext } | null) ?? {};
  const sched = ctx.scheduler ?? {};
  let consecutiveFailures = sched.consecutiveFailures ?? 0;

  if (reason === 'error') {
    consecutiveFailures += 1;
    if (consecutiveFailures >= HEARTBEAT_FAILURE_FUSE) {
      log(
        'fuse blown: task=%s consecutiveFailures=%d — not re-arming',
        task.identifier,
        consecutiveFailures,
      );
      await taskModel.updateContext(task.id, {
        scheduler: { consecutiveFailures },
      });
      return false;
    }
  } else if (reason === 'done' || reason === 'bootstrap') {
    consecutiveFailures = 0;
  }

  if (await briefModel.hasUnresolvedUrgentByTask(task.id, { excludeTypes: ['error'] })) {
    log('skip re-arm: task=%s has unresolved urgent brief', task.identifier);
    await taskModel.updateContext(task.id, {
      scheduler: { consecutiveFailures },
    });
    return false;
  }

  try {
    const scheduler = createTaskSchedulerModule();

    // Cancel previous tick if any
    if (sched.tickMessageId) {
      await scheduler.cancelScheduled(sched.tickMessageId).catch(() => undefined);
    }

    const tickMessageId = await scheduler.scheduleNextTopic({
      delay: task.heartbeatInterval!,
      taskId: task.id,
      userId: deps.userId,
    });

    await taskModel.updateContext(task.id, {
      scheduler: {
        consecutiveFailures,
        scheduledAt: new Date().toISOString(),
        tickMessageId: tickMessageId || `local-task-${task.id}-${Date.now()}`,
      },
    });

    log(
      'scheduled heartbeat task=%s delay=%ds messageId=%s reason=%s',
      task.identifier,
      task.heartbeatInterval,
      tickMessageId,
      reason,
    );
    return true;
  } catch (e) {
    console.warn('[TaskHeartbeat] schedule failed:', e);
    return false;
  }
};

export const syncHeartbeatScheduleAfterTaskUpdate = async (
  deps: HeartbeatScheduleDeps,
  previous: TaskItem | null,
  next: TaskItem,
): Promise<void> => {
  if (shouldCancelHeartbeatOnConfigChange(previous, next) && previous) {
    await cancelHeartbeatSchedule(deps, previous);
  }

  if (shouldBootstrapHeartbeatOnConfigChange(previous, next)) {
    await scheduleHeartbeatTick(deps, next, { reason: 'bootstrap' });
  }
};

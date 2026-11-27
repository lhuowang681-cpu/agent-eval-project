// @vitest-environment node
import type { TaskItem, TaskSchedulerContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelHeartbeatSchedule,
  scheduleHeartbeatTick,
  shouldBootstrapHeartbeatOnConfigChange,
  shouldCancelHeartbeatOnConfigChange,
  syncHeartbeatScheduleAfterTaskUpdate,
} from './heartbeatBootstrap';

const { fakeScheduler, hasUnresolvedUrgent, updateContext } = vi.hoisted(() => ({
  fakeScheduler: {
    cancelScheduled: vi.fn().mockResolvedValue(undefined),
    scheduleNextTopic: vi.fn().mockResolvedValue('msg-new'),
  },
  hasUnresolvedUrgent: vi.fn().mockResolvedValue(false),
  updateContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => fakeScheduler,
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn().mockImplementation(() => ({
    hasUnresolvedUrgentByTask: hasUnresolvedUrgent,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    updateContext,
  })),
}));

const baseTask = (overrides: Partial<TaskItem> = {}): TaskItem =>
  ({
    automationMode: 'heartbeat',
    config: {},
    context: {},
    error: null,
    heartbeatInterval: 30,
    heartbeatTimeout: 600,
    id: 'task-1',
    identifier: 'TASK-1',
    name: 'demo',
    status: 'paused',
    ...overrides,
  }) as unknown as TaskItem;

const deps = { db: {} as any, userId: 'user-1' };

describe('heartbeatBootstrap helpers', () => {
  it('shouldBootstrap when switching to heartbeat', () => {
    expect(
      shouldBootstrapHeartbeatOnConfigChange(
        baseTask({ automationMode: null }),
        baseTask({ automationMode: 'heartbeat', heartbeatInterval: 600 }),
      ),
    ).toBe(true);
  });

  it('shouldBootstrap when interval changes in heartbeat mode', () => {
    expect(
      shouldBootstrapHeartbeatOnConfigChange(
        baseTask({ heartbeatInterval: 600 }),
        baseTask({ heartbeatInterval: 1200 }),
      ),
    ).toBe(true);
  });

  it('should not bootstrap when heartbeat config unchanged', () => {
    expect(
      shouldBootstrapHeartbeatOnConfigChange(
        baseTask({ automationMode: 'heartbeat', heartbeatInterval: 600 }),
        baseTask({ automationMode: 'heartbeat', heartbeatInterval: 600, name: 'renamed' }),
      ),
    ).toBe(false);
  });

  it('shouldCancel when leaving heartbeat mode', () => {
    expect(
      shouldCancelHeartbeatOnConfigChange(
        baseTask({ automationMode: 'heartbeat', heartbeatInterval: 600 }),
        baseTask({ automationMode: 'schedule', heartbeatInterval: 600 }),
      ),
    ).toBe(true);
  });
});

describe('scheduleHeartbeatTick', () => {
  beforeEach(() => {
    fakeScheduler.scheduleNextTopic.mockClear().mockResolvedValue('msg-new');
    fakeScheduler.cancelScheduled.mockClear().mockResolvedValue(undefined);
    updateContext.mockClear().mockResolvedValue(null);
    hasUnresolvedUrgent.mockClear().mockResolvedValue(false);
  });

  it('schedules next tick and writes scheduler context on done', async () => {
    await scheduleHeartbeatTick(deps, baseTask(), { reason: 'done' });

    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalledWith({
      delay: 30,
      taskId: 'task-1',
      userId: 'user-1',
    });
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({
        consecutiveFailures: 0,
        tickMessageId: 'msg-new',
      }),
    });
  });

  it('bootstraps with zeroed failure count', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { consecutiveFailures: 2 },
    };

    await scheduleHeartbeatTick(deps, baseTask({ context: ctx }), { reason: 'bootstrap' });

    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: expect.objectContaining({ consecutiveFailures: 0 }),
    });
  });

  it('skips when automationMode is not heartbeat', async () => {
    await scheduleHeartbeatTick(deps, baseTask({ automationMode: null }), { reason: 'done' });

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
    expect(updateContext).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'canceled'])('skips on terminal status %s', async (status) => {
    await scheduleHeartbeatTick(deps, baseTask({ status }), { reason: 'done' });

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
  });

  it('blows the fuse at 3 consecutive errors and stops re-arming', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { consecutiveFailures: 2 },
    };

    await scheduleHeartbeatTick(deps, baseTask({ context: ctx }), { reason: 'error' });

    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith('task-1', {
      scheduler: { consecutiveFailures: 3 },
    });
  });
});

describe('syncHeartbeatScheduleAfterTaskUpdate', () => {
  beforeEach(() => {
    fakeScheduler.scheduleNextTopic.mockClear().mockResolvedValue('msg-new');
    updateContext.mockClear().mockResolvedValue(null);
    hasUnresolvedUrgent.mockClear().mockResolvedValue(false);
  });

  it('bootstraps when user enables heartbeat after task ran without it', async () => {
    const previous = baseTask({ automationMode: null, heartbeatInterval: null });
    const next = baseTask({ automationMode: 'heartbeat', heartbeatInterval: 600 });

    await syncHeartbeatScheduleAfterTaskUpdate(deps, previous, next);

    expect(fakeScheduler.scheduleNextTopic).toHaveBeenCalled();
    expect(updateContext).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        scheduler: expect.objectContaining({ tickMessageId: expect.any(String) }),
      }),
    );
  });

  it('cancels pending ticks when heartbeat is disabled', async () => {
    const previous = baseTask({
      automationMode: 'heartbeat',
      context: { scheduler: { tickMessageId: 'msg-old' } },
      heartbeatInterval: 600,
    });
    const next = baseTask({ automationMode: null, heartbeatInterval: 0 });

    await syncHeartbeatScheduleAfterTaskUpdate(deps, previous, next);

    expect(fakeScheduler.cancelScheduled).toHaveBeenCalled();
    expect(fakeScheduler.scheduleNextTopic).not.toHaveBeenCalled();
  });
});

describe('cancelHeartbeatSchedule', () => {
  beforeEach(() => {
    fakeScheduler.cancelScheduled.mockClear().mockResolvedValue(undefined);
    updateContext.mockClear().mockResolvedValue(null);
  });

  it('cancels scheduled tick and clears context', async () => {
    const ctx: { scheduler: TaskSchedulerContext } = {
      scheduler: { tickMessageId: 'msg-123' },
    };

    await cancelHeartbeatSchedule(deps, baseTask({ context: ctx }));

    expect(fakeScheduler.cancelScheduled).toHaveBeenCalledWith('msg-123');
  });
});

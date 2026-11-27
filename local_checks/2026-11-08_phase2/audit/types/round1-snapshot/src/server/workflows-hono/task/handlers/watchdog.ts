import debug from 'debug';
import type { Context } from 'hono';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

const log = debug('lobe-server:workflows:task:watchdog');

/**
 * Cron-style watchdog. Scans all `running` tasks where
 * `lastHeartbeatAt + heartbeatTimeout < now()` and reaps the hung run.
 *
 * A stuck task is really an interrupted run whose completion callback never
 * fired (e.g. the runtime died mid tool-call). How we reap it depends on the
 * task kind:
 *   - Automation tasks (schedule / heartbeat): recovering through the
 *     lifecycle's `interrupted` path returns them to `scheduled` (or
 *     `completed` once the run cap is hit) so the NEXT tick fires normally. A
 *     single hung tick must never tear down the whole schedule — and marking it
 *     `failed` would do exactly that, since the cron dispatcher skips both
 *     `failed` and `running` tasks.
 *   - Manual one-shot tasks: there is no schedule to preserve, so mark them
 *     `failed` and raise an urgent brief for the user.
 *
 * No per-user authentication: this is a global sweep registered as a QStash
 * Schedule (cron). Auth is handled by the `qstashAuth` middleware
 * mounted on the route.
 */
export async function watchdog(c: Context) {
  try {
    const db = await getServerDB();
    const stuckTasks = await TaskModel.findStuckTasks(db);
    const recovered: string[] = [];
    const failed: string[] = [];

    for (const task of stuckTasks) {
      const userId = task.createdByUserId;

      if (task.automationMode) {
        // Reuse the authoritative lifecycle finalization so recovery stays in
        // lock-step with a normal interrupted tick (topic → canceled, task →
        // scheduled/completed, heartbeat re-armed). Never fails the schedule.
        const lifecycle = new TaskLifecycleService(db, userId);
        await lifecycle.onTopicComplete({
          // operationId is unused on the 'interrupted' path (it only drives the
          // 'done' review flow); pass empty to satisfy the type.
          operationId: '',
          reason: 'interrupted',
          taskId: task.id,
          taskIdentifier: task.identifier,
          topicId: task.currentTopicId ?? undefined,
        });
        recovered.push(task.identifier);
      } else {
        const taskModel = new TaskModel(db, userId);
        await taskModel.updateStatus(task.id, 'failed', {
          completedAt: new Date(),
          error: 'Heartbeat timeout',
        });

        const briefModel = new BriefModel(db, userId);
        await briefModel.create({
          agentId: task.assigneeAgentId || undefined,
          priority: 'urgent',
          summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
          taskId: task.id,
          title: `${task.identifier} heartbeat timeout`,
          trigger: 'task',
          type: 'error',
        });

        failed.push(task.identifier);
      }
    }

    log(
      'Watchdog scan: checked=%d recovered=%d failed=%d',
      stuckTasks.length,
      recovered.length,
      failed.length,
    );
    return c.json({
      checked: stuckTasks.length,
      failed,
      recovered,
      success: true,
    });
  } catch (error) {
    console.error('[task/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

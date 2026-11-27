import { registerQstashPlatformSchedule } from './qstashPlatformSchedule';

/** Matches lobehub flowControl key prefix for hourly memory extraction workflow. */
export const MEMORY_HOURLY_SCHEDULE_ID = 'memory-user-memory.call-cron-hourly-analysis';

/** Every 2 hours at minute 0 — QStash Schedule POSTs the platform cron shim. */
export const MEMORY_HOURLY_CRON = '0 */2 * * *';

/** Message-delivery target (not a `serve()` URL). Shim calls `Client.trigger()` for the workflow. */
export const MEMORY_HOURLY_TARGET_PATH = '/api/internal/platform-cron/memory-hourly';

/**
 * Register platform QStash Schedule for memory extraction every 2 hours.
 *
 * Schedule → `/api/internal/platform-cron/memory-hourly` →
 * `MemoryExtractionWorkflowService.triggerHourly` → zxqstash `/v1/workflows/runs` →
 * `WorkflowStepDelivery` → `call-cron-hourly-analysis` (`hourly.ts`).
 */
export async function registerMemoryHourlySchedule(): Promise<void> {
  await registerQstashPlatformSchedule({
    cron: MEMORY_HOURLY_CRON,
    disableEnvVar: 'DISABLE_MEMORY_HOURLY_SCHEDULE',
    scheduleId: MEMORY_HOURLY_SCHEDULE_ID,
    targetPath: MEMORY_HOURLY_TARGET_PATH,
  });
}

import { registerQstashPlatformSchedule } from './qstashPlatformSchedule';

const TASK_SCHEDULE_DISPATCH_ID = 'lobe-task-schedule-dispatch';
const TASK_SCHEDULE_DISPATCH_CRON = '*/10 * * * *';

/**
 * Register a platform @ctrip/qstash Schedule that periodically POSTs
 * `/api/workflows/task/schedule-dispatch` (central cron scanner for user tasks).
 */
export async function registerTaskScheduleDispatch(): Promise<void> {
  await registerQstashPlatformSchedule({
    cron: TASK_SCHEDULE_DISPATCH_CRON,
    disableEnvVar: 'DISABLE_TASK_SCHEDULE_DISPATCH',
    scheduleId: TASK_SCHEDULE_DISPATCH_ID,
    targetPath: '/api/workflows/task/schedule-dispatch',
  });
}

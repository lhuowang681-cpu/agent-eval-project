import { registerAgentOperationWatchdog } from './registerAgentOperationWatchdog';
import { registerMemoryHourlySchedule } from './registerMemoryHourlySchedule';
import { registerTaskScheduleDispatch } from './registerTaskScheduleDispatch';

/**
 * Builtin platform crons (lobehub parity): task schedule-dispatch + memory
 * hourly workflow + callSubAgent dead-child watchdog.
 */
export async function registerPlatformQstashSchedules(): Promise<void> {
  await Promise.all([
    registerTaskScheduleDispatch(),
    registerMemoryHourlySchedule(),
    registerAgentOperationWatchdog(),
  ]);
}

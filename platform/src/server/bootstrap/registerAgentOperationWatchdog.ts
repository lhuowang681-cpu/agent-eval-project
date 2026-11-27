import { registerQstashPlatformSchedule } from './qstashPlatformSchedule';

const AGENT_OPERATION_WATCHDOG_ID = 'lobe-agent-operation-watchdog';
const AGENT_OPERATION_WATCHDOG_CRON = '*/5 * * * *';

/**
 * Register a platform @ctrip/qstash Schedule that periodically POSTs
 * `/api/workflows/agent-operation/watchdog` — the `callSubAgent` dead-child
 * bridge sweep (see `agentOperation/handlers/watchdog.ts`).
 */
export async function registerAgentOperationWatchdog(): Promise<void> {
  await registerQstashPlatformSchedule({
    cron: AGENT_OPERATION_WATCHDOG_CRON,
    disableEnvVar: 'DISABLE_AGENT_OPERATION_WATCHDOG',
    scheduleId: AGENT_OPERATION_WATCHDOG_ID,
    targetPath: '/api/workflows/agent-operation/watchdog',
  });
}

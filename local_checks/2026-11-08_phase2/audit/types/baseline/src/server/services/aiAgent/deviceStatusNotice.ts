import type { ExecutionPlan, ExecutionPlanUnroutedReason } from '@/helpers/executionTarget';

const REASON_TEXT: Record<ExecutionPlanUnroutedReason, string> = {
  'ambiguous-online-devices':
    'multiple desktop devices are online and none is bound, so none could be selected',
  'bound-device-offline': 'the bound desktop device is offline',
  'no-bound-device': 'no desktop device is bound',
  'no-online-device': 'no desktop device is online',
};

/**
 * When a run is configured to use a desktop device but the device is not
 * reachable (`device-unrouted`), build a system note so the agent explains the
 * degraded state instead of silently producing a useless run — or worse,
 * pretending a device-only action (e.g. lark-cli) succeeded.
 *
 * Returns `undefined` when the plan routed to a device, or never wanted one
 * (`none` / `sandbox`), so non-device runs are left untouched.
 */
export const buildDeviceStatusNotice = (plan: ExecutionPlan): string | undefined => {
  if (plan.kind !== 'device-unrouted') return undefined;

  const reason = REASON_TEXT[plan.reason] ?? 'the desktop device is not reachable';

  return [
    '<device_status>',
    `This run is configured to use the user's desktop device, but ${reason}.`,
    'Tools and skills that run on the local desktop (e.g. the Feishu CLI / lark-cli skill) are unavailable for this run.',
    'If the request depends on them, tell the user their desktop app must be running and connected (`lh connect`), and do NOT claim the action succeeded.',
    '</device_status>',
  ].join('\n');
};

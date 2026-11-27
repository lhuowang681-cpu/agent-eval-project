import { describe, expect, it } from 'vitest';

import type { ExecutionPlan } from '@/helpers/executionTarget';

import { buildDeviceStatusNotice } from './deviceStatusNotice';

describe('buildDeviceStatusNotice', () => {
  it('returns undefined when the plan routed to a device', () => {
    const plan: ExecutionPlan = { deviceId: 'device-a', kind: 'device', target: 'device' };
    expect(buildDeviceStatusNotice(plan)).toBeUndefined();
  });

  it('returns undefined for non-device plans (none / sandbox)', () => {
    expect(buildDeviceStatusNotice({ kind: 'none', target: 'none' })).toBeUndefined();
    expect(buildDeviceStatusNotice({ kind: 'sandbox', target: 'sandbox' })).toBeUndefined();
  });

  it('builds a notice for a bound-but-offline device', () => {
    const notice = buildDeviceStatusNotice({
      kind: 'device-unrouted',
      reason: 'bound-device-offline',
      target: 'device',
    });
    expect(notice).toContain('<device_status>');
    expect(notice).toContain('the bound desktop device is offline');
    expect(notice).toContain('lark-cli');
    expect(notice).toContain('do NOT claim the action succeeded');
  });

  it('maps each unrouted reason to its own wording', () => {
    const reasons = [
      ['no-online-device', 'no desktop device is online'],
      ['ambiguous-online-devices', 'multiple desktop devices are online'],
      ['no-bound-device', 'no desktop device is bound'],
    ] as const;

    for (const [reason, expected] of reasons) {
      const notice = buildDeviceStatusNotice({ kind: 'device-unrouted', reason, target: 'device' });
      expect(notice).toContain(expected);
    }
  });
});

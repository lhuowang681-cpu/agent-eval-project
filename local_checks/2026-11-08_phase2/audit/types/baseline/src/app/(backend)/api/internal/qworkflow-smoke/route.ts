import { serve } from '@ctrip/qworkflow/nextjs';

interface SmokePayload {
  label?: string;
  n?: number;
}

/**
 * Minimal @ctrip/qworkflow smoke endpoint — no DB, no downstream triggers.
 * Used by `scripts/qworkflow-smoke.ts` to verify zxqstash ↔ TripYoYo step delivery.
 */
export const { POST } = serve<SmokePayload>(async (context) => {
  const payload = context.requestPayload ?? {};

  const echo = await context.run('smoke:echo', async () => ({
    label: payload.label ?? 'ping',
    receivedAt: new Date().toISOString(),
  }));

  const sum = await context.run('smoke:add', async () => {
    const n = typeof payload.n === 'number' ? payload.n : 1;
    return n + 1;
  });

  return { echo, ok: true, sum };
});

// @vitest-environment node
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalAuth } from './internalAuth';

describe('internalAuth', () => {
  afterEach(() => {
    delete process.env.INTERNAL_WEBHOOK_SECRET;
    vi.unstubAllEnvs();
  });

  it('allows requests when INTERNAL_WEBHOOK_SECRET is unset', async () => {
    delete process.env.INTERNAL_WEBHOOK_SECRET;

    const app = new Hono();
    app.post('/test', internalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects requests with missing bearer when secret is configured', async () => {
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', 'test-secret');

    const app = new Hono();
    app.post('/test', internalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('allows requests with valid bearer when secret is configured', async () => {
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', 'test-secret');

    const app = new Hono();
    app.post('/test', internalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer test-secret' },
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

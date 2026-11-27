// @vitest-environment node
import { createHmac } from 'node:crypto';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { qstashOrInternalAuth } from './qstashOrInternalAuth';

const SIGNING_KEY = 'test-signing-key';

function signBody(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SIGNING_KEY).update(`${ts}.${body}`).digest('hex');
  return `v1:${ts}:${sig}`;
}

describe('qstashOrInternalAuth', () => {
  afterEach(() => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    delete process.env.INTERNAL_WEBHOOK_SECRET;
    vi.unstubAllEnvs();
  });

  it('allows requests when no auth is configured', async () => {
    const app = new Hono();
    app.post('/test', qstashOrInternalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
  });

  it('allows internal bearer auth', async () => {
    vi.stubEnv('INTERNAL_WEBHOOK_SECRET', 'secret');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', SIGNING_KEY);
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-key');

    const app = new Hono();
    app.post('/test', qstashOrInternalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(200);
  });

  it('allows valid QStash signature', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', SIGNING_KEY);
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-key');

    const body = '{"taskId":"t1"}';
    const app = new Hono();
    app.post('/test', qstashOrInternalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      method: 'POST',
      body,
      headers: { 'X-ZxQstash-Signature': signBody(body) },
    });
    expect(res.status).toBe(200);
  });

  it('rejects unsigned fetch when auth is configured', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', SIGNING_KEY);
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-key');

    const app = new Hono();
    app.post('/test', qstashOrInternalAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/test', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });
});

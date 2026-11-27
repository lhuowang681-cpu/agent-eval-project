import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { isInternalWebhookAuthEnabled, verifyInternalWebhookBearer } from '@/libs/internalWebhook';
import { verifyQStashSignature } from '@/libs/qstash';

const log = debug('lobe-server:workflows:qstash-or-internal-auth');

/**
 * Accept QStash-signed webhooks (from @ctrip/qstash delivery) or internal
 * server-to-server fetch (Bearer INTERNAL_WEBHOOK_SECRET).
 *
 * Used for endpoints like `on-topic-complete` that receive:
 * - QStash POST when hook `delivery: 'qstash'`
 * - Direct fetch from AgentRuntimeService / HookDispatcher when `delivery: 'fetch'`
 */
export const qstashOrInternalAuth = (): MiddlewareHandler => async (c, next) => {
  const hasQstashKey = Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY);
  const hasInternal = isInternalWebhookAuthEnabled();

  if (!hasQstashKey && !hasInternal) {
    await next();
    return;
  }

  if (hasInternal && verifyInternalWebhookBearer(c.req.raw.headers)) {
    await next();
    return;
  }

  if (hasQstashKey) {
    const rawBody = await c.req.text();
    const ok = await verifyQStashSignature(c.req.raw, rawBody);
    if (ok) {
      await next();
      return;
    }
  }

  log('Rejected: invalid QStash signature and internal auth on %s', c.req.path);
  return c.json({ error: 'Unauthorized' }, 401);
};

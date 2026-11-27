import debug from 'debug';
import type { MiddlewareHandler } from 'hono';

import { isInternalWebhookAuthEnabled, verifyInternalWebhookBearer } from '@/libs/internalWebhook';

const log = debug('lobe-server:workflows:internal-auth');

/**
 * Protect internal cron / webhook HTTP endpoints.
 * Skips verification when INTERNAL_WEBHOOK_SECRET is unset (local dev).
 */
export const internalAuth = (): MiddlewareHandler => async (c, next) => {
  if (isInternalWebhookAuthEnabled() && !verifyInternalWebhookBearer(c.req.raw.headers)) {
    log('Rejected: invalid internal webhook auth on %s', c.req.path);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};

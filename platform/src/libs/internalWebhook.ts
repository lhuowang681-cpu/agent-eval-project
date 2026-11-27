import debug from 'debug';

const log = debug('lobe-server:internal-webhook');

export const getInternalWebhookSecret = (): string | undefined =>
  process.env.INTERNAL_WEBHOOK_SECRET?.trim() || undefined;

export const isInternalWebhookAuthEnabled = (): boolean => Boolean(getInternalWebhookSecret());

/**
 * Verify `Authorization: Bearer <INTERNAL_WEBHOOK_SECRET>` on incoming requests.
 * When the secret is unset, verification is skipped (local dev).
 */
export const verifyInternalWebhookBearer = (headers: Headers): boolean => {
  const secret = getInternalWebhookSecret();
  if (!secret) {
    log('Internal webhook auth disabled (INTERNAL_WEBHOOK_SECRET not configured)');
    return true;
  }

  const auth = headers.get('Authorization');
  if (auth !== `Bearer ${secret}`) {
    log('Missing or invalid Authorization header');
    return false;
  }

  return true;
};

/** Headers for server-to-server POSTs to internal webhook endpoints. */
export const getInternalWebhookHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const secret = getInternalWebhookSecret();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  return headers;
};

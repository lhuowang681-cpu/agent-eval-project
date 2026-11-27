import { Client, Receiver } from '@ctrip/qstash';
import { Client as WorkflowClient } from '@ctrip/qworkflow';
import debug from 'debug';
import urlJoin from 'url-join';

const log = debug('lobe-server:qstash');

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

/**
 * Lazily construct a client on first property access and proxy through to it.
 *
 * The underlying `@ctrip/qstash` clients validate `ZXQSTASH_SERVER_URL` in their
 * constructor and throw synchronously when it is missing. Constructing them at
 * module top-level would run during `next build`'s "collect page data" phase
 * (which imports every route module), failing the build because runtime env
 * vars are not present then. Deferring construction to first use keeps the
 * named exports unchanged while moving the throw to request time.
 */
const lazyClient = <T extends object>(factory: () => T): T => {
  let instance: T | undefined;
  const resolve = () => (instance ??= factory());
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const value = Reflect.get(resolve() as object, prop, receiver);
      return typeof value === 'function' ? value.bind(resolve()) : value;
    },
  });
};

/**
 * QStash client with Vercel Deployment Protection bypass headers.
 * Use as `qstashClient` option in Upstash Workflow `serve()`.
 *
 * @see https://upstash.com/docs/workflow/troubleshooting/vercel
 */
export const qstashClient = lazyClient(
  () =>
    new Client({
      headers,
      token: process.env.ZXQSTASH_TOKEN!,
    }),
);

/**
 * Workflow client with Vercel Deployment Protection bypass headers.
 * Use for triggering workflows via `workflowClient.trigger()`.
 */
export const workflowClient = lazyClient(
  () =>
    new WorkflowClient({
      headers,
      token: process.env.ZXQSTASH_TOKEN!,
    }),
);

/**
 * Verify QStash signature using Receiver.
 * Returns true if signing keys are not configured (verification skipped) or signature is valid.
 */
export async function verifyQStashSignature(request: Request, rawBody: string): Promise<boolean> {
  const currentSigningKey = process.env.ZXQSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.ZXQSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey || !nextSigningKey) {
    log('QStash signature verification disabled (no signing keys configured)');
    return false;
  }

  // Support both @ctrip signature header and legacy Upstash header
  const signature =
    request.headers.get('X-ZxQstash-Signature') || request.headers.get('Upstash-Signature');
  if (!signature) {
    log('Missing signature header (X-ZxQstash-Signature or Upstash-Signature)');
    return false;
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch (error) {
    log('QStash signature verification failed: %O', error);
    return false;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * Resolve a webhook target URL.
 *
 * QStash delivery is performed by an external consumer (the shared zxqstash
 * server) that cannot reach `INTERNAL_APP_URL` — a localhost/pod-internal
 * address meant for in-process server-to-server self-calls. For `qstash`
 * delivery, use the public `APP_URL`. For `fetch` delivery (in-process
 * self-call), `INTERNAL_APP_URL` is correct so the call bypasses the CDN.
 *
 * Absolute URLs (`http`/`https`) are returned unchanged.
 */
export function resolveWebhookUrl(url: string, delivery: 'fetch' | 'qstash' = 'fetch'): string {
  if (url.startsWith('http')) return url;

  const base =
    delivery === 'qstash'
      ? process.env.APP_URL || ''
      : process.env.INTERNAL_APP_URL || process.env.APP_URL || '';

  return urlJoin(base, url);
}

/**
 * Fail-fast guard for externally-delivered (QStash) target URLs.
 *
 * In non-development environments, a localhost target means the env is
 * misconfigured (APP_URL not set to the public URL) — the external QStash
 * consumer will fail to reach it. Throw early so the misconfig is loud in
 * logs and we avoid enqueueing a delivery that is doomed to fail.
 *
 * `development` is exempted: localhost targets are expected there.
 */
export function assertPublicDeliveryUrl(url: string): void {
  if (process.env.NODE_ENV === 'development') return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }

  if (LOCAL_HOSTS.has(host)) {
    throw new Error(
      `QStash delivery target is a localhost URL (${url}). Set APP_URL to the public environment URL so the external QStash consumer can reach it.`,
    );
  }
}

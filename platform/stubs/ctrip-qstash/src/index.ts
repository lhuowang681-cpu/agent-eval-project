/**
 * Local QStash emulator, standing in for `@ctrip/qstash`.
 *
 * ── Why this is an emulator and not a throwing stub ──────────────────────────
 * The original offline setup (PLAN.md decision 8, old host) had no Redis, so
 * `AGENT_RUNTIME_MODE=queue` was unreachable and this package only ever needed to
 * fail loudly. On the current host Redis is a resident service, which makes queue
 * mode viable — and queue mode is the only path that constructs
 * `AgentStateManager` (see `src/server/modules/AgentRuntime/factory.ts`). Without
 * it the step lock stays the `return true` no-op in `InMemoryAgentStateManager`,
 * and the whole 429 / `Retry-After: 37` re-entrancy story is untestable.
 *
 * So instead of throwing, this emulates the one QStash behaviour the agent loop
 * depends on: "deliver this JSON body to this URL after N seconds, with a
 * verifiable signature, and retry on failure".
 *
 * ── Fidelity ─────────────────────────────────────────────────────────────────
 * The signature is a real HS256 JWT modelled on Upstash's documented scheme
 * (`@ctrip/qstash` is a fork of `@upstash/qstash`): claims carry `iss`/`sub`/
 * `exp`/`nbf`/`iat`/`jti` plus `body`, the base64url SHA-256 of the delivered
 * payload. `Receiver.verify` performs genuine HMAC verification against the
 * current key and then the next key, and checks the body hash and expiry.
 *
 * That matters: `verifyQStashSignature` (`src/libs/qstash/index.ts:65-90`) is
 * fail-closed by design, and until now nothing ever exercised its success path.
 * A stub that returned `true` unconditionally would have left the auth branch
 * just as untested as one that returned `false`.
 *
 * What is NOT emulated: durable storage (a process restart loses in-flight
 * messages, same caveat as `LocalQueueServiceImpl`), DLQ, flow control, and
 * fan-out. Retries are in-process.
 *
 * ── Offline guarantee ────────────────────────────────────────────────────────
 * Delivery targets are hard-restricted to loopback hosts. A misconfigured
 * `AGENT_RUNTIME_BASE_URL` / `APP_URL` therefore fails loudly instead of
 * quietly shipping conversation payloads off the machine.
 */
import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';

const debugEnabled = () => process.env.STUB_QSTASH_DEBUG === '1';
const trace = (...args: unknown[]) => {
  if (debugEnabled()) console.info('[stub:qstash]', ...args);
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const b64urlDecode = (input: string): Buffer =>
  Buffer.from(input.replaceAll('-', '+').replaceAll('_', '/'), 'base64');

const sha256B64Url = (body: string): string => b64url(createHash('sha256').update(body).digest());

/** Reject any delivery target that is not loopback — see "Offline guarantee". */
const assertLoopbackTarget = (url: string): void => {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[stub:qstash] delivery URL is not parseable: ${url}`);
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `[stub:qstash] refusing to deliver to non-loopback host "${host}" (${url}). ` +
        `This emulator is for offline use only — point AGENT_RUNTIME_BASE_URL/APP_URL at localhost.`,
    );
  }
};

const signingKeys = (): { current: string; next: string } => {
  const current = process.env.ZXQSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.ZXQSTASH_NEXT_SIGNING_KEY;

  if (!current || !next) {
    throw new Error(
      '[stub:qstash] ZXQSTASH_CURRENT_SIGNING_KEY and ZXQSTASH_NEXT_SIGNING_KEY must both be set ' +
        'when AGENT_RUNTIME_MODE=queue. verifyQStashSignature is fail-closed, so an unsigned ' +
        'delivery would just 401.',
    );
  }

  return { current, next };
};

const sign = (payload: Record<string, unknown>, key: string): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${claims}`;
  const mac = b64url(createHmac('sha256', key).update(signingInput).digest());
  return `${signingInput}.${mac}`;
};

const verifyWithKey = (token: string, body: string, key: string): boolean => {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [header, claims, mac] = parts;
  const expected = createHmac('sha256', key).update(`${header}.${claims}`).digest();
  const actual = b64urlDecode(mac);

  if (actual.length !== expected.length) return false;
  if (!timingSafeEqual(actual, expected)) return false;

  let parsed: { body?: string; exp?: number; nbf?: number };
  try {
    parsed = JSON.parse(b64urlDecode(claims).toString('utf8'));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  // 60s of slack so a slow step boundary does not produce a spurious 401.
  if (typeof parsed.exp === 'number' && now > parsed.exp + 60) return false;
  if (typeof parsed.nbf === 'number' && now + 60 < parsed.nbf) return false;

  // Body integrity — this is what makes tampering detectable.
  if (typeof parsed.body === 'string' && parsed.body !== sha256B64Url(body)) return false;

  return true;
};

export class QstashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QstashError';
  }
}

export class QstashHttpError extends QstashError {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'QstashHttpError';
    this.status = status;
  }
}

export class QstashNetworkError extends QstashError {
  constructor(message: string) {
    super(message);
    this.name = 'QstashNetworkError';
  }
}

export class QstashRateLimitError extends QstashError {
  constructor(message: string) {
    super(message);
    this.name = 'QstashRateLimitError';
  }
}

export interface ClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  token?: string;
}

export interface PublishRequest {
  body?: unknown;
  /** Seconds, matching QStashQueueServiceImpl's `Math.ceil(delay / 1000)`. */
  delay?: number;
  headers?: Record<string, string>;
  method?: string;
  retries?: number;
  url: string;
}

interface DeliveryOutcome {
  attempts: number;
  status: number;
}

/**
 * Deliver one message, retrying on 5xx and on 429.
 *
 * The 429 path is the point of this whole file: `AgentRuntimeService.executeStep`
 * answers 429 + `Retry-After: 37` when it loses the step lock, and relies on the
 * queue to redeliver. Honouring `Retry-After` here is what makes that contract
 * observable locally.
 */
const deliver = async (
  request: PublishRequest,
  messageId: string,
  maxRetries: number,
): Promise<DeliveryOutcome> => {
  const { current } = signingKeys();
  const serialized = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});

  assertLoopbackTarget(request.url);

  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;

    const issuedAt = Math.floor(Date.now() / 1000);
    const token = sign(
      {
        body: sha256B64Url(serialized),
        exp: issuedAt + 300,
        iat: issuedAt,
        iss: 'Upstash',
        jti: randomUUID(),
        nbf: issuedAt,
        sub: request.url,
      },
      current,
    );

    let status: number;
    let retryAfter: number | undefined;

    try {
      const response = await fetch(request.url, {
        body: serialized,
        headers: {
          'Content-Type': 'application/json',
          ...request.headers,
          // Both header names are accepted by verifyQStashSignature.
          'Upstash-Signature': token,
          'Upstash-Message-Id': messageId,
          'X-ZxQstash-Signature': token,
        },
        method: request.method ?? 'POST',
      });

      status = response.status;
      const header = response.headers.get('Retry-After');
      if (header) retryAfter = Number(header);

      // Drain so the socket is released even when we ignore the payload.
      await response.text().catch(() => '');
    } catch (error) {
      trace(`delivery ${messageId} attempt ${attempt} network error`, error);
      if (attempt > maxRetries) {
        throw new QstashNetworkError(
          `[stub:qstash] delivery to ${request.url} failed after ${attempt} attempts: ${String(error)}`,
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(attempt * 500, 5000)));
      continue;
    }

    trace(`delivery ${messageId} attempt ${attempt} → ${status}`);

    if (status < 400) return { attempts: attempt, status };

    // 4xx other than 429 are terminal: retrying a 401 or a 400 just repeats it.
    if (status !== 429 && status < 500) {
      trace(`delivery ${messageId} gave up on terminal ${status}`);
      return { attempts: attempt, status };
    }

    if (attempt > maxRetries) {
      trace(`delivery ${messageId} exhausted ${maxRetries} retries at status ${status}`);
      return { attempts: attempt, status };
    }

    const waitMs = retryAfter ? retryAfter * 1000 : Math.min(attempt * 1000, 10_000);
    trace(`delivery ${messageId} retrying in ${waitMs}ms (status ${status})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
};

/** In-flight timers, so `messages.delete` can act as a real cancellation. */
const scheduled = new Map<string, NodeJS.Timeout>();

export class Client {
  readonly messages = {
    delete: async (messageId: string): Promise<void> => {
      const timer = scheduled.get(messageId);
      if (timer) {
        clearTimeout(timer);
        scheduled.delete(messageId);
        trace(`cancelled ${messageId}`);
      }
    },
    get: async (messageId: string): Promise<unknown> => ({
      messageId,
      state: scheduled.has(messageId) ? 'PENDING' : 'DELIVERED',
    }),
  };

  constructor(_options: ClientOptions = {}) {}

  async publishJSON(request: PublishRequest): Promise<{ messageId: string }> {
    const messageId = `stub_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const delayMs = Math.max(0, (request.delay ?? 0) * 1000);
    const maxRetries = request.retries ?? 3;

    // Validate eagerly so misconfiguration surfaces at schedule time, on the
    // caller's stack, rather than inside a detached timer.
    assertLoopbackTarget(request.url);
    signingKeys();

    trace(`scheduling ${messageId} → ${request.url} in ${delayMs}ms`);

    const timer = setTimeout(() => {
      scheduled.delete(messageId);
      deliver(request, messageId, maxRetries).catch((error) => {
        console.error(`[stub:qstash] delivery ${messageId} failed:`, error);
      });
    }, delayMs);

    // Do not hold the event loop open purely for a pending delivery.
    timer.unref?.();
    scheduled.set(messageId, timer);

    return { messageId };
  }

  async batchJSON(requests: PublishRequest[]): Promise<{ messageId: string }[]> {
    return Promise.all(requests.map((request) => this.publishJSON(request)));
  }
}

export interface ReceiverOptions {
  currentSigningKey: string;
  nextSigningKey: string;
}

export class Receiver {
  private currentSigningKey: string;
  private nextSigningKey: string;

  constructor(options: ReceiverOptions) {
    this.currentSigningKey = options.currentSigningKey;
    this.nextSigningKey = options.nextSigningKey;
  }

  /**
   * Real HMAC verification against the current key, falling back to the next key
   * so key rotation behaves as it does in production.
   */
  async verify(params: { body: string; signature: string }): Promise<boolean> {
    const { body, signature } = params;
    if (!signature) return false;

    if (verifyWithKey(signature, body, this.currentSigningKey)) return true;
    if (verifyWithKey(signature, body, this.nextSigningKey)) return true;

    trace('signature verification failed for both current and next keys');
    return false;
  }
}

export default { Client, Receiver };

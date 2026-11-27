/**
 * Shared client for the offline API test scripts.
 *
 * Every request carries the development auth bypass header, which resolves to
 * MOCK_DEV_USER_ID server-side (guarded by NODE_ENV === 'development').
 */
import 'dotenv/config';

export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3010';
export const MOCK_LLM_URL = process.env.TEST_MOCK_LLM_URL ?? 'http://localhost:8088';

export const authHeaders = {
  'Content-Type': 'application/json',
  'lobe-auth-dev-backend-api': '1',
};

// ── tRPC ────────────────────────────────────────────────────────────────────
// The routers use superjson, so inputs are wrapped as { json: ... } and results
// come back as { result: { data: { json: ... } } }.

export const trpcQuery = async <T = any>(
  path: string,
  input?: unknown,
  namespace = 'lambda',
): Promise<T> => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE_URL}/trpc/${namespace}/${path}${qs}`, { headers: authHeaders });
  const body = await res.json();
  if (body.error) throw new Error(`trpc ${path} failed: ${JSON.stringify(body.error.json ?? body.error)}`);
  return body.result?.data?.json as T;
};

export const trpcMutate = async <T = any>(
  path: string,
  input?: unknown,
  namespace = 'lambda',
): Promise<T> => {
  const res = await fetch(`${BASE_URL}/trpc/${namespace}/${path}`, {
    body: JSON.stringify({ json: input ?? {} }),
    headers: authHeaders,
    method: 'POST',
  });
  const body = await res.json();
  if (body.error) throw new Error(`trpc ${path} failed: ${JSON.stringify(body.error.json ?? body.error)}`);
  return body.result?.data?.json as T;
};

// ── REST ────────────────────────────────────────────────────────────────────

export const rest = async (
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { body, status: res.status, text };
};

// ── Mock LLM control ────────────────────────────────────────────────────────

export const setScenario = async (scenario: string, extra: Record<string, unknown> = {}) => {
  const res = await fetch(`${MOCK_LLM_URL}/__mock/config`, {
    body: JSON.stringify({ scenario, ...extra }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!res.ok) throw new Error(`failed to set mock scenario ${scenario}: ${await res.text()}`);
  return res.json();
};

// ── SSE ─────────────────────────────────────────────────────────────────────

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Subscribe to /api/agent/stream and collect events until `agent_runtime_end`
 * (or the timeout elapses).
 */
export const collectStream = async (
  operationId: string,
  { timeoutMs = 60_000, includeHistory = true } = {},
): Promise<{ events: StreamEvent[]; endedCleanly: boolean; elapsedMs: number }> => {
  const started = Date.now();
  const events: StreamEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${BASE_URL}/api/agent/stream?operationId=${encodeURIComponent(operationId)}&includeHistory=${includeHistory}&lastEventId=0`;

  let endedCleanly = false;

  try {
    // SSE 现在同样要求认证（L1）—— 与真实客户端一致：Web 带 cookie、
    // 桌面端带 Oidc-Auth、这里带开发态旁路头。少了它会直接 401。
    const res = await fetch(url, {
      headers: { ...authHeaders, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.body) throw new Error('SSE response has no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as StreamEvent;
            events.push(evt);
            if (evt.type === 'agent_runtime_end') endedCleanly = true;
          } catch {
            /* ignore non-JSON frames */
          }
        }
      }

      if (endedCleanly) break;
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  return { elapsedMs: Date.now() - started, endedCleanly, events };
};

// ── reporting ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

export const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    passed += 1;
    console.info(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
};

export const summary = () => {
  console.info(`\n${'─'.repeat(60)}`);
  console.info(`通过 ${passed} / 失败 ${failed}`);
  console.info('─'.repeat(60));
  return failed === 0;
};

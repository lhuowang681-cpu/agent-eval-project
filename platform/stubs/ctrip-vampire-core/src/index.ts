/**
 * Local no-op stub for `@ctrip/vampire-core`.
 *
 * The real package is Ctrip's APM framework. It is deliberately NOT installed here:
 * this repo shadows npm's `debug` (see `packages/debug`), force-enables the `lobe-*`
 * namespaces regardless of the `DEBUG` env var, and forwards every such log line to
 * `triplog`. The agent runtime logs full reasoning traces, full LLM output and full
 * tool-call arguments (`RuntimeExecutors.ts:572-580`), so that forwarding path carries
 * conversation content. The real package cannot be audited from outside the intranet,
 * so on a local-only setup we stub it out rather than trust it.
 *
 * Set `STUB_TRIPLOG_CONSOLE=1` to echo triplog calls to the console for debugging.
 */

const echo = () => process.env.STUB_TRIPLOG_CONSOLE === '1';

export interface TriplogPayload {
  message?: string;
  title?: string;
  type?: string;
  [key: string]: unknown;
}

export const triplog = {
  custom: (payload: TriplogPayload = {}) => {
    if (echo()) console.info('[stub:triplog]', payload.title ?? '', payload.message ?? '');
  },
  debug: (payload: TriplogPayload = {}) => triplog.custom({ ...payload, type: 'debug' }),
  error: (payload: TriplogPayload = {}) => triplog.custom({ ...payload, type: 'error' }),
  info: (payload: TriplogPayload = {}) => triplog.custom({ ...payload, type: 'info' }),
  setTraceContext: (key: string, value: unknown) => {
    if (echo()) console.info('[stub:triplog] setTraceContext', key, value);
  },
  warn: (payload: TriplogPayload = {}) => triplog.custom({ ...payload, type: 'warn' }),
};

type HookListener = (...args: unknown[]) => unknown;

export const serverHook = {
  activeHookServer: () => {
    if (echo()) console.info('[stub:serverHook] activeHookServer (no-op)');
  },
  emitHook: () => undefined,
  off: (_event: string, _listener?: HookListener) => undefined,
  on: (_event: string, _listener: HookListener) => undefined,
};

export const bootstrap = async (): Promise<void> => {
  if (echo()) console.info('[stub:vampire-core] bootstrap (no-op)');
};

/**
 * QConfig — Ctrip's remote configuration service.
 *
 * `packages/utils/src/qconfig/index.js` eagerly subscribes to `ai-infra-config.json` and
 * `app-config.json` at import time, and that module is pulled into every API route via the
 * server config chain. Offline there is no config service, so `get()` resolves to an empty
 * object and `on('change')` never fires — consumers fall back to their own defaults
 * (see genServerAiProviderConfig, which already handles a null/empty ai-infra config).
 *
 * This does NOT throw, unlike the other stubs: it sits on the import path of essentially
 * every request, so failing loudly here would take down the whole server rather than the
 * one feature that actually needs remote config.
 */
export interface QConfigHandle {
  get: () => Promise<Record<string, unknown>>;
  on: (event: string, listener: (payload: unknown) => void) => void;
  off?: (event: string, listener?: (payload: unknown) => void) => void;
}

export const qconfig = {
  getConfig: (key: string): QConfigHandle => {
    if (echo()) console.info(`[stub:qconfig] getConfig(${key}) → {}`);
    return {
      get: async () => ({}),
      off: () => undefined,
      on: () => undefined,
    };
  },
};

export default { bootstrap, qconfig, serverHook, triplog };

import { Client } from '@ctrip/qstash';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

let cachedClient: Client | undefined;

const resolveClient = () =>
  (cachedClient ??= new Client({
    headers: { ...upstashWorkflowExtraHeaders },
    token: process.env.ZXQSTASH_TOKEN!,
  }));

// NOTICE(@nekomeowww): Scenarios like Vercel Deployment Protection require custom headers on
// intermediate `context.run(...)` calls (which don't accept per-call headers). We inject them via
// a shared QStash client. See:
// https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
//
// The client is created lazily behind a Proxy: callers (e.g. top-level `serve()` options) invoke
// this factory at module-eval time, but `@ctrip/qstash`'s `Client` constructor throws synchronously
// when `ZXQSTASH_SERVER_URL` is missing. Deferring construction to first property access keeps that
// throw out of `next build`'s "collect page data" phase, where runtime env vars are absent.
export const createWorkflowQstashClient = (): Client =>
  new Proxy({} as Client, {
    get(_target, prop, receiver) {
      const value = Reflect.get(resolveClient() as object, prop, receiver);
      return typeof value === 'function' ? value.bind(resolveClient()) : value;
    },
  });

export { upstashWorkflowExtraHeaders };

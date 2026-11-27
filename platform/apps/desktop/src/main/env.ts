import { createEnv } from '@t3-oss/env-core';
import { memoize } from 'es-toolkit';
import { z } from 'zod';

const normalizeEnvString = (input: unknown) => {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

const envBoolean = (defaultValue: boolean) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;

      switch (str.toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'y':
        case 'on': {
          return true;
        }

        case '0':
        case 'false':
        case 'no':
        case 'n':
        case 'off': {
          return false;
        }

        default: {
          return undefined;
        }
      }
    }, z.boolean().optional())
    .default(defaultValue);

const envNumber = (defaultValue: number) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;
      const num = Number(str);
      if (!Number.isFinite(num)) return undefined;
      return num;
    }, z.number().optional())
    .default(defaultValue);

/**
 * Desktop (Electron main process) runtime env access.
 *
 * Important:
 * - Keep schemas tolerant (optional + defaults) to avoid throwing in tests/dev.
 * - Prefer reading env at call-time (factory) so tests can mutate process.env safely.
 */
export const getDesktopEnv = memoize(() =>
  createEnv({
    client: {},
    clientPrefix: 'PUBLIC_',
    emptyStringAsUndefined: true,
    isServer: true,
    runtimeEnv: process.env,
    server: {
      DEBUG_VERBOSE: envBoolean(false),

      // escape hatch: allow testing static renderer in dev via env
      DESKTOP_RENDERER_STATIC: envBoolean(false),

      // device gateway URL override (dev: point at a local mock/wrangler gateway).
      // Falls back to the store value, then the production default in the service.
      // `default(process.env.DEVICE_GATEWAY_URL)` bakes the build-time value in
      // (via electron.vite.config.ts `define`) so a packaged app — which has no
      // parent process to inherit env from — still gets the right gateway URL
      // instead of falling through to the service's hardcoded constant.
      DEVICE_GATEWAY_URL: z.string().optional().default(process.env.DEVICE_GATEWAY_URL),

      // Force use dev-app-update.yml even in packaged app (for testing updates)
      FORCE_DEV_UPDATE_CONFIG: envBoolean(false),

      // mcp client
      MCP_TOOL_TIMEOUT: envNumber(60_000),

      // keep optional to preserve existing behavior:
      // - unset NODE_ENV should behave like "not production" in logger runtime paths
      NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

      // cloud server url (can be overridden for selfhost/dev)
      // process.env.OFFICIAL_CLOUD_SERVER is statically replaced at build stage
      // (see electron.vite.config.ts define), falling back to the train (prod) server.
      OFFICIAL_CLOUD_SERVER: z
        .string()
        .optional()
        .default(process.env.OFFICIAL_CLOUD_SERVER || 'https://calcifer.train.ctripcorp.com'),

      // updater
      // process.env.xxx will replace in build stage
      UPDATE_CHANNEL: z.string().optional().default(process.env.UPDATE_CHANNEL),

      // Custom update server URL (for stable channel)
      // e.g., https://releases.calcifer.train.ctripcorp.com/stable or https://your-bucket.s3.amazonaws.com/releases
      UPDATE_SERVER_URL: z.string().optional().default(process.env.UPDATE_SERVER_URL),

      // macOS auto-update: prefer the extranet (download2.ctrip.com) download URL as-is
      // instead of rewriting to the intranet (download2.ctripcorp.com) host.
      UPDATE_USE_OUTSIDE: envBoolean(false),

      // Vercel JWT for bypassing deployment protection (dev only)
      VERCEL_JWT: z.string().optional(),
    },
  }),
);

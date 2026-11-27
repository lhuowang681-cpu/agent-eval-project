import { triplog } from '@ctrip/vampire-core';

import { asyncTrpc } from './init';

export const triplogContext = asyncTrpc.middleware(async ({ ctx, path, type, next }) => {
  const userId = ctx.userId;

  triplog.setTraceContext('trpc', 'async');
  triplog.setTraceContext('method', path);

  if (userId) {
    triplog.setTraceContext('uid', userId);
  }

  if (type !== 'mutation') {
    return next();
  }

  const startMs = Date.now();

  try {
    const result = await next();

    triplog.custom({
      message: `${result.ok ? '[END]' : '[FAIL]'} async | user=${userId ?? 'anonymous'} duration=${Date.now() - startMs}ms success=${result.ok}`,
      title: 'trpc.async',
      type: result.ok ? 'info' : 'warn',
    });

    return result;
  } catch (error) {
    triplog.custom({
      message: `[ERROR] async | user=${userId ?? 'anonymous'} duration=${Date.now() - startMs}ms error=${error instanceof Error ? error.message : String(error)}`,
      title: 'trpc.async',
      type: 'error',
    });

    throw error;
  }
});

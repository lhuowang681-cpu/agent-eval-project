export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // Auto-start the bot GatewayManager on server start for non-Vercel
  // environments (Docker, local). Persistent bots (Feishu websocket long
  // connection) need reconnection after a restart. On Vercel, the cron at
  // /api/agent/gateway/start handles this instead. In local dev, opt-in via
  // ENABLE_BOT_IN_DEV to avoid clobbering a shared bot binding.
  const isDev = process.env.NODE_ENV !== 'production';
  if (
    process.env.DATABASE_URL &&
    !process.env.VERCEL_ENV &&
    (!isDev || process.env.ENABLE_BOT_IN_DEV === '1')
  ) {
    const { GatewayService } = await import('@/server/services/gateway');
    const service = new GatewayService();
    service.ensureRunning().catch((err) => {
      console.error('[Instrumentation] Failed to auto-start GatewayManager:', err);
    });
  }

  await import('./instrumentation.node');
}

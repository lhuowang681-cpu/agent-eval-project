import app from '@/server/workflows-hono/agentOperation';

/**
 * Catch-all entry for the agent-operation dead-child watchdog subsystem.
 *
 * The Hono app (`@/server/workflows-hono/agentOperation`) carries the base
 * path `/api/workflows/agent-operation` and dispatches the QStash webhook
 * receiver:
 *   - POST /api/workflows/agent-operation/watchdog
 */
export const POST = (request: Request) => app.fetch(request);

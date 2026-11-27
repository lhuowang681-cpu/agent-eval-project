import app from '@/server/workflows-hono/memory-user-memory';

/**
 * Catch-all entry for the memory-user-memory workflow subsystem.
 *
 * The Hono app (`@/server/workflows-hono/memory-user-memory`) carries the base path
 * `/api/workflows/memory-user-memory` and dispatches the QStash workflow receivers:
 *   - POST /api/workflows/memory-user-memory/call-cron-hourly-analysis
 *   - POST /api/workflows/memory-user-memory/pipelines/persona/update-writing
 *   - POST /api/workflows/memory-user-memory/pipelines/chat-topic/process-users
 *   - POST /api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics
 *   - POST /api/workflows/memory-user-memory/pipelines/chat-topic/process-topics
 *   - POST /api/workflows/memory-user-memory/pipelines/chat-topic/process-topic
 *
 * Mounted under the `memory-user-memory/` subpath (rather than a top-level
 * `api/workflows/[[...route]]`) so it coexists with TripYoYo's existing
 * per-endpoint Upstash Workflow routes without route collisions.
 */
export const POST = (request: Request) => app.fetch(request);

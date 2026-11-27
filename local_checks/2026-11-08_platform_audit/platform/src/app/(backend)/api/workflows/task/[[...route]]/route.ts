import app from '@/server/workflows-hono/task';

/**
 * Catch-all entry for the agent task workflow subsystem.
 *
 * The Hono app (`@/server/workflows-hono/task`) carries the base path
 * `/api/workflows/task` and dispatches the QStash webhook receivers:
 *   - POST /api/workflows/task/on-topic-complete
 *   - POST /api/workflows/task/heartbeat-tick
 *   - POST /api/workflows/task/schedule-dispatch
 *   - POST /api/workflows/task/schedule-execute
 *   - POST /api/workflows/task/watchdog
 *
 * Mounted under the `task/` subpath (rather than a top-level
 * `api/workflows/[[...route]]`) so it coexists with TripYoYo's existing
 * per-endpoint Upstash Workflow routes without route collisions.
 */
export const POST = (request: Request) => app.fetch(request);

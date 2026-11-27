import app from '@/server/workflows-hono/memory';

export const POST = (request: Request) => app.fetch(request);

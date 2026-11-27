import app from '@/server/workflows-hono/eval';

export const POST = (request: Request) => app.fetch(request);

import app from '@/server/workflows-hono/platform-cron';

export const POST = (request: Request) => app.fetch(request);

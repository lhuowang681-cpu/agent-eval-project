import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { triggerMemoryHourlyWorkflow } from './handlers/triggerMemoryHourlyWorkflow';

const app = new Hono().basePath('/api/internal/platform-cron');

app.post('/memory-hourly', qstashAuth(), triggerMemoryHourlyWorkflow);

export default app;

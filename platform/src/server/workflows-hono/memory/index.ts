import { Hono } from 'hono';

import { internalAuth } from '../middlewares/internalAuth';
import { hourlyMemoryExtraction } from './handlers/hourly';

const app = new Hono().basePath('/api/internal/memory');

app.post('/hourly', internalAuth(), hourlyMemoryExtraction);

export default app;

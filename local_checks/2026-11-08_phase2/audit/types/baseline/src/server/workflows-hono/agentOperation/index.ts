import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { watchdog } from './handlers/watchdog';

// Mounted directly at the Next route `app/(backend)/api/workflows/agent-operation/[[...route]]`,
// so the Hono app carries the full base path to match incoming request URLs.
const app = new Hono().basePath('/api/workflows/agent-operation');

app.post('/watchdog', qstashAuth(), watchdog);

export default app;

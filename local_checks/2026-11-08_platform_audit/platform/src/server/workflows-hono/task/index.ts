import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { qstashOrInternalAuth } from '../middlewares/qstashOrInternalAuth';
import { heartbeatTick } from './handlers/heartbeatTick';
import { onTopicComplete } from './handlers/onTopicComplete';
import { scheduleDispatch } from './handlers/scheduleDispatch';
import { scheduleExecute } from './handlers/scheduleExecute';
import { watchdog } from './handlers/watchdog';

// Mounted directly at the Next route `app/(backend)/api/workflows/task/[[...route]]`,
// so the Hono app carries the full base path to match incoming request URLs.
const app = new Hono().basePath('/api/workflows/task');

app.post('/on-topic-complete', qstashOrInternalAuth(), onTopicComplete);
app.post('/heartbeat-tick', qstashAuth(), heartbeatTick);
app.post('/schedule-dispatch', qstashAuth(), scheduleDispatch);
app.post('/schedule-execute', qstashAuth(), scheduleExecute);
app.post('/watchdog', qstashAuth(), watchdog);

export default app;

import { Hono } from 'hono';

import { internalAuth } from '../middlewares/internalAuth';
import { onThreadComplete } from './handlers/onThreadComplete';
import { onTrajectoryComplete } from './handlers/onTrajectoryComplete';

const app = new Hono().basePath('/api/internal/eval');

app.post('/on-trajectory-complete', internalAuth(), onTrajectoryComplete);
app.post('/on-thread-complete', internalAuth(), onThreadComplete);

export default app;

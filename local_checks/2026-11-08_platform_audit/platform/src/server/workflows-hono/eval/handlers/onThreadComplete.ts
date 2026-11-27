import type { Context } from 'hono';

import { AgentEvalRunOrchestrator } from '@/server/services/agentEvalRun/orchestrator';
import type { OnThreadCompletePayload } from '@/server/services/agentEvalRun/types';

export const onThreadComplete = async (c: Context) => {
  const body = (await c.req.json()) as OnThreadCompletePayload;
  const { userId } = body;

  if (!userId) {
    return c.json({ error: 'Missing userId' }, 400);
  }

  const orchestrator = await AgentEvalRunOrchestrator.create(userId);
  const result = await orchestrator.onThreadComplete(body);

  if ('error' in result && result.error) {
    return c.json(result, 400);
  }

  if ('cancelled' in result && result.cancelled) {
    return c.json(result);
  }

  return c.json(result);
};

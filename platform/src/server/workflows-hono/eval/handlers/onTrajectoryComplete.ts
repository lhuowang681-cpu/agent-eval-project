import type { Context } from 'hono';

import { AgentEvalRunOrchestrator } from '@/server/services/agentEvalRun/orchestrator';
import type { OnTrajectoryCompletePayload } from '@/server/services/agentEvalRun/types';

export const onTrajectoryComplete = async (c: Context) => {
  const body = (await c.req.json()) as OnTrajectoryCompletePayload;
  const { userId } = body;

  if (!userId) {
    return c.json({ error: 'Missing userId' }, 400);
  }

  const orchestrator = await AgentEvalRunOrchestrator.create(userId);
  const result = await orchestrator.onTrajectoryComplete(body);

  if ('error' in result && result.error) {
    return c.json(result, 400);
  }

  if ('cancelled' in result && result.cancelled) {
    return c.json(result);
  }

  return c.json(result);
};

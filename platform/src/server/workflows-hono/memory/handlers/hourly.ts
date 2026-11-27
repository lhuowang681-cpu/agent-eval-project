import type { Context } from 'hono';

import { appEnv } from '@/envs/app';
import { getInternalWebhookHeaders } from '@/libs/internalWebhook';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import type { MemoryExtractionHourlyWorkflowPayload } from '@/server/services/memory/userMemory/extract';
import { MemoryExtractionOrchestrator } from '@/server/services/memory/userMemory/orchestrator';

export async function hourlyMemoryExtraction(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as MemoryExtractionHourlyWorkflowPayload;
    const { webhook } = parseMemoryExtractionConfig();
    const baseUrl = webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

    if (!baseUrl) {
      return c.json({ error: 'Missing baseUrl for hourly memory extraction' }, 500);
    }

    const orchestrator = await MemoryExtractionOrchestrator.create();
    const result = await orchestrator.runHourlyScan({ ...body, baseUrl });

    if (result.nextCursor && result.hasNextPage && !body.dryRun) {
      const url = new URL('/api/internal/memory/hourly', baseUrl);
      void fetch(url, {
        body: JSON.stringify({
          cursor: result.nextCursor,
          dryRun: body.dryRun,
        }),
        headers: getInternalWebhookHeaders(),
        method: 'POST',
      }).catch((error) => {
        console.error('[memory/hourly] failed to schedule next page', error);
      });
    }

    return c.json(result);
  } catch (error) {
    console.error('[memory/hourly] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

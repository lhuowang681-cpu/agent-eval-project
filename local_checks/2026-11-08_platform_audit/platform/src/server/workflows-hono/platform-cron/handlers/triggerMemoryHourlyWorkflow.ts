import type { Context } from 'hono';

import { appEnv } from '@/envs/app';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  type MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionWorkflowService,
} from '@/server/services/memory/userMemory/extract';

/**
 * Platform cron shim: QStash Schedule POSTs here (message delivery, body may be `{}`).
 * Triggers the hourly memory workflow via zxqstash `POST /v1/workflows/runs` so the app
 * receives a proper `WorkflowStepDelivery` on `call-cron-hourly-analysis`.
 */
export async function triggerMemoryHourlyWorkflow(c: Context) {
  try {
    const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();
    // QStash workflow triggers are delivered by the external zxqstash consumer;
    // target the public APP_URL, not the internal self-call address.
    const baseUrl = webhook.baseUrl || appEnv.APP_URL;

    if (!baseUrl) {
      return c.json({ error: 'Missing baseUrl for hourly memory extraction workflow' }, 500);
    }

    const rawBody = (await c.req.json().catch(() => ({}))) as MemoryExtractionHourlyWorkflowPayload;
    const payload: MemoryExtractionHourlyWorkflowPayload = {
      ...rawBody,
      baseUrl,
    };

    const { workflowRunId } = await MemoryExtractionWorkflowService.triggerHourly(payload, {
      extraHeaders: upstashWorkflowExtraHeaders,
    });

    return c.json({ ok: true, workflowRunId });
  } catch (error) {
    console.error('[platform-cron/memory-hourly] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

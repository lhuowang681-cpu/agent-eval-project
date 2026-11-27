import debug from 'debug';

import { getInternalWebhookHeaders } from '@/libs/internalWebhook';
import { assertPublicDeliveryUrl, resolveWebhookUrl } from '@/libs/qstash';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import type {
  AgentHook,
  AgentHookEvent,
  AgentHookType,
  AgentHookWebhook,
  SerializedHook,
} from './types';

const log = debug('lobe-server:hook-dispatcher');

/**
 * Delivers a webhook via HTTP POST (fetch or QStash)
 */
export async function deliverWebhook(
  webhook: AgentHookWebhook,
  payload: Record<string, unknown>,
): Promise<void> {
  const { url, delivery = 'fetch' } = webhook;

  // QStash delivery is performed by an external consumer; it must target the
  // public APP_URL, not INTERNAL_APP_URL (a localhost/pod-internal address).
  const resolvedUrl = resolveWebhookUrl(url, delivery);

  if (delivery === 'qstash') {
    // Fail fast on misconfigured localhost targets before enqueueing a doomed
    // delivery. Thrown here propagates to dispatch's non-fatal catch (no fetch
    // fallback to the bad URL).
    assertPublicDeliveryUrl(resolvedUrl);

    try {
      const { Client } = await import('@ctrip/qstash');
      const qstashToken = process.env.ZXQSTASH_TOKEN;
      if (!qstashToken) {
        log('QStash token not available, falling back to fetch delivery');
        await fetchDeliver(resolvedUrl, payload);
        return;
      }
      const client = new Client({ token: qstashToken });
      await client.publishJSON({
        body: payload,
        headers: {
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }),
        },
        url: resolvedUrl,
      });
      log('Webhook delivered via QStash: %s', url);
    } catch (error) {
      log('QStash delivery failed, falling back to fetch: %O', error);
      await fetchDeliver(resolvedUrl, payload);
    }
  } else {
    await fetchDeliver(resolvedUrl, payload);
  }
}

async function fetchDeliver(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(url, {
      body: JSON.stringify(payload),
      headers: getInternalWebhookHeaders(),
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.text();
      log('Webhook fetch delivery failed: %s (status: %d) %s', url, res.status, body.slice(0, 200));
      return;
    }
    log('Webhook delivered via fetch: %s (status: %d)', url, res.status);
  } catch (error) {
    log('Webhook fetch delivery failed: %s %O', url, error);
    // Hook errors should not affect main flow
  }
}

/**
 * HookDispatcher — central hub for registering and dispatching agent lifecycle hooks
 *
 * Local mode: hooks are stored in memory, handler functions called directly
 * Production mode: webhook configs persisted in AgentState.metadata._hooks,
 *   delivered via HTTP POST or QStash
 */
export class HookDispatcher {
  /**
   * In-memory hook store (local mode)
   * Maps operationId → AgentHook[]
   */
  private hooks: Map<string, AgentHook[]> = new Map();

  /**
   * Dispatch hooks for a given event type
   *
   * In local mode: calls handler functions from memory
   * In production mode: delivers webhooks from serialized config
   */
  async dispatch(
    operationId: string,
    type: AgentHookType,
    event: AgentHookEvent,
    serializedHooks?: SerializedHook[],
  ): Promise<void> {
    const isQueueMode = isQueueAgentRuntimeEnabled();

    if (!isQueueMode) {
      // Local mode: call handler functions directly
      const hooks = this.hooks.get(operationId)?.filter((h) => h.type === type) || [];

      for (const hook of hooks) {
        try {
          log('[%s][%s] Dispatching local hook: %s', operationId, type, hook.id);
          await hook.handler(event);
        } catch (error) {
          log('[%s][%s] Hook error (non-fatal): %s %O', operationId, type, hook.id, error);
          // Hook errors should NOT affect main execution flow
        }
      }
    } else {
      // Production mode: deliver via webhooks
      const webhookHooks =
        serializedHooks?.filter((h) => h.type === type && h.webhook) ||
        this.getSerializedHooks(operationId)?.filter((h) => h.type === type) ||
        [];

      for (const hook of webhookHooks) {
        try {
          log(
            '[%s][%s] Delivering webhook hook: %s → %s',
            operationId,
            type,
            hook.id,
            hook.webhook.url,
          );
          await deliverWebhook(hook.webhook, {
            ...event,
            hookId: hook.id,
            hookType: type,
            ...hook.webhook.body,
          });
        } catch (error) {
          log(
            '[%s][%s] Webhook delivery error (non-fatal): %s %O',
            operationId,
            type,
            hook.id,
            error,
          );
        }
      }
    }
  }

  /**
   * Get serialized hooks for an operation (for production mode persistence)
   */
  getSerializedHooks(operationId: string): SerializedHook[] | undefined {
    const hooks = this.hooks.get(operationId);
    if (!hooks) return undefined;

    return hooks
      .filter((h) => h.webhook)
      .map((h) => ({
        id: h.id,
        type: h.type,
        webhook: h.webhook!,
      }));
  }

  /**
   * Check if any hooks are registered for an operation
   */
  hasHooks(operationId: string): boolean {
    return (this.hooks.get(operationId)?.length ?? 0) > 0;
  }

  /**
   * Register hooks for an operation
   *
   * In local mode: stores hooks in memory (including handler functions)
   * In production mode: caller should persist getSerializedHooks() to state.metadata._hooks
   */
  register(operationId: string, hooks: AgentHook[]): void {
    if (hooks.length === 0) return;

    const existing = this.hooks.get(operationId) || [];
    this.hooks.set(operationId, [...existing, ...hooks]);

    log(
      '[%s] Registered %d hooks: %s',
      operationId,
      hooks.length,
      hooks.map((h) => `${h.type}:${h.id}`).join(', '),
    );
  }

  /**
   * Unregister all hooks for an operation (cleanup)
   */
  unregister(operationId: string): void {
    this.hooks.delete(operationId);
    log('[%s] Unregistered all hooks', operationId);
  }
}

/**
 * Singleton instance — shared across the application
 */
export const hookDispatcher = new HookDispatcher();

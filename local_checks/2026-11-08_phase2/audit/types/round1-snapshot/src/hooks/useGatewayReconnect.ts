import useSWR from 'swr';

import { useChatStore } from '@/store/chat';

interface RunningOperation {
  assistantMessageId: string;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

/**
 * Auto-reconnect to a running server operation on the given topic.
 *
 * The caller sources `runningOperation` itself — the chat-store topic map
 * (main agent) and the task-detail activity (task drawer) live in different
 * stores, so this hook stays source-agnostic.
 *
 * NOT gated on `agentGatewayUrl`: TripYoYo streams operations over the internal
 * `/api/agent/stream` SSE endpoint (proxied to the remote server on desktop),
 * which is always available regardless of gateway config. A server-run task
 * (Run now / scheduled) populates `runningOperation`, and any tab viewing the
 * topic re-attaches to its stream. The gateway *mode* toggle only controls where
 * NEW requests run, not resuming an op that's already streaming.
 *
 * SWR key is the operationId, so the same operation deduplicates and only
 * one reconnect attempt fires per op.
 */
export const useGatewayReconnect = (
  topicId: string | null | undefined,
  runningOperation: RunningOperation | null | undefined,
  agentId: string | null | undefined,
) => {
  useSWR(
    runningOperation && topicId && agentId
      ? ['reconnectGateway', runningOperation.operationId]
      : null,
    async () => {
      if (!runningOperation || !topicId || !agentId) return;

      // The method may be absent on the chat store in builds that don't ship the
      // gateway reconnect action, so call it optionally.
      const store = useChatStore.getState() as {
        reconnectToGatewayOperation?: (params: {
          agentId: string;
          assistantMessageId: string;
          operationId: string;
          scope?: string;
          threadId?: string | null;
          topicId: string;
        }) => Promise<void>;
      };

      await store.reconnectToGatewayOperation?.({
        agentId,
        assistantMessageId: runningOperation.assistantMessageId,
        operationId: runningOperation.operationId,
        scope: runningOperation.scope,
        threadId: runningOperation.threadId,
        topicId,
      });
    },
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

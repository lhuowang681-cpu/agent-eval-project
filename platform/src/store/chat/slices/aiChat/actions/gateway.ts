import { LOADING_FLAT } from '@lobechat/const';
import { type ConversationContext, type RuntimeInitialContext } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { agentRuntimeClient, type StreamEvent } from '@/services/agentRuntime';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { settingsSelectors, toolInterventionSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

const log = debug('store:chat:ai-chat:gateway');

type Setter = StoreSetter<ChatStore>;

export const gateway = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new GatewayActionImpl(set, get, _api);

export interface ExecuteGatewayAgentParams {
  context: ConversationContext;
  /**
   * Regenerate: existing context message IDs (history up to and including the
   * reused user message). Forwarded as `existingMessageIds` so the server builds
   * the run context from them instead of the full topic history.
   */
  existingMessageIds?: string[];
  /** Attachments already uploaded; their IDs are attached to the new user message. */
  files?: Array<{ id: string }>;
  /**
   * Composer-selected tools/skills/@mentions for this message (phase-init runtime
   * context). Forwarded so explicit picks take effect on the server run too.
   */
  initialContext?: RuntimeInitialContext;
  /** User input/prompt. */
  message: string;
  /** Reserved for regenerate/continue (not yet wired on the gateway path). */
  parentMessageId?: string;
  /**
   * Regenerate: reuse this existing user message instead of creating a new one.
   * When set, no temp user message is created — the server branches a fresh
   * assistant message under it.
   */
  reuseUserMessageId?: string;
}

export interface ReconnectToGatewayOperationParams {
  /**
   * Agent that owns the topic. Required: the message-map key is
   * `main_{agentId}_{topicId}`, so reconnect must rebuild the SAME context the
   * UI reads from — without it, `replaceMessages` would write to a key nobody
   * subscribes to and the view would never update.
   */
  agentId: string;
  assistantMessageId: string;
  operationId: string;
  scope?: string;
  threadId?: string | null;
  topicId: string;
}

export interface GatewayAction {
  /**
   * Run an agent on the server and stream the result back. Calls `execAgent`
   * (server creates the messages + starts the operation, routing tools by the
   * agent's `executionPlan` — device / sandbox / local), then subscribes to the
   * SSE event stream and syncs events into the chat message store via the shared
   * `internal_handleAgentStreamEvent` handler. This is what makes the
   * execution-target choice (sandbox / device / auto) actually change where the
   * agent executes — the loop runs server-side instead of in-process.
   */
  executeGatewayAgent: (params: ExecuteGatewayAgentParams) => Promise<void>;
  /**
   * Whether new requests should be dispatched to the gateway. Gated by server
   * config: requires both `agentGatewayUrl` and `enableGatewayMode`.
   */
  isGatewayModeEnabled: (agentId?: string) => boolean;
  /** Re-attach to a run already in progress on the gateway (e.g. after reload). */
  reconnectToGatewayOperation: (params: ReconnectToGatewayOperationParams) => Promise<void>;
}

/**
 * Agent Gateway client actions.
 *
 * `isGatewayModeEnabled` is gated by server config: it returns `false` unless
 * the deployment sets both `agentGatewayUrl` and `enableGatewayMode`, so the
 * default path stays in-process (`selectRuntimeType` → `client`).
 *
 * `executeGatewayAgent` reuses TripYoYo's existing server-run + Redis-stream +
 * SSE machinery (the same path group chat and bot/task already use) rather than
 * an external WebSocket gateway: it mirrors `sendGroupMessage` but dispatches to
 * the single-agent `execAgent` endpoint.
 */
export class GatewayActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  isGatewayModeEnabled = (agentId?: string): boolean => {
    // Server gate: the feature is only available when the deployment configures
    // both the gateway URL and the flag. Without it the per-agent toggle is moot.
    const serverConfig = window.global_serverConfigStore?.getState()?.serverConfig;
    if (!serverConfig?.agentGatewayUrl || !serverConfig?.enableGatewayMode) return false;

    // Per-agent user toggle (ActionBar gateway button): gateway is OFF by default;
    // it only runs on the server when explicitly turned on (persisted as
    // `chatConfig.disableGatewayMode === false`). Anything else — unset or `true`
    // — keeps the run in-process. Falls back to the user's default agent config.
    const resolvedAgentId = agentId ?? getAgentStoreState().activeAgentId ?? '';
    const disableGatewayMode =
      chatConfigByIdSelectors.getChatConfigById(resolvedAgentId)(getAgentStoreState())
        .disableGatewayMode ??
      settingsSelectors.defaultAgentConfig(getUserStoreState()).chatConfig?.disableGatewayMode;

    return disableGatewayMode === false;
  };

  executeGatewayAgent = async ({
    context,
    message,
    files,
    initialContext,
    reuseUserMessageId,
    existingMessageIds,
  }: ExecuteGatewayAgentParams): Promise<void> => {
    const { agentId, groupId, threadId } = context;
    const inputTopicId = context.topicId;
    const isRegenerate = !!reuseUserMessageId;

    if (!agentId) {
      log('executeGatewayAgent: missing agentId in context');
      return;
    }

    const { optimisticCreateTmpMessage, startOperation } = this.#get();

    log(
      'executeGatewayAgent: agentId=%s, regenerate=%s, message=%s',
      agentId,
      isRegenerate,
      message.slice(0, 50),
    );

    // 0. Create the parent operation first so loading state is correct during the
    //    execAgent round-trip. It's completed as soon as the stream op takes over
    //    (step 7) rather than at the end of the run: for a new topic it's keyed on
    //    the pre-switch `_new` context, so leaving it running would let the
    //    OpStatusTray resurface it the moment the user opens a fresh topic (also
    //    `_new`). The real run status is driven by the stream op (real topic ctx).
    const tempUserId = 'tmp_' + nanoid();
    const tempAssistantId = 'tmp_' + nanoid();
    const fileIds = files?.map((f) => f.id);

    const { operationId: execOperationId, abortController: execAbortController } = startOperation({
      context: { ...context, messageId: reuseUserMessageId ?? tempUserId },
      label: 'Execute Server Agent',
      type: 'execServerAgentRuntime',
    });

    // 1. Optimistic temp messages for instant UI feedback. On regenerate the user
    //    message already exists, so only the assistant placeholder is created.
    if (!isRegenerate) {
      optimisticCreateTmpMessage(
        {
          agentId,
          content: message,
          files: fileIds,
          groupId,
          role: 'user',
          threadId: threadId ?? undefined,
          topicId: inputTopicId ?? undefined,
        },
        { operationId: execOperationId, tempMessageId: tempUserId },
      );
      this.#get().internal_toggleMessageLoading(true, tempUserId);
    }
    optimisticCreateTmpMessage(
      {
        agentId,
        content: LOADING_FLAT,
        groupId,
        role: 'assistant',
        threadId: threadId ?? undefined,
        topicId: inputTopicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempAssistantId },
    );
    this.#get().internal_toggleMessageLoading(true, tempAssistantId);

    // Temp messages actually created (no temp user on regenerate) — used for cleanup.
    const tempIds = isRegenerate ? [tempAssistantId] : [tempUserId, tempAssistantId];

    try {
      // 2. Server creates messages + starts the operation (routes tools by
      //    executionPlan). `includeMessages` enriches the response for UI sync.
      const result = await lambdaClient.aiAgent.execAgent.mutate(
        {
          agentId,
          appContext: {
            groupId: groupId ?? undefined,
            threadId: threadId ?? undefined,
            topicId: inputTopicId ?? undefined,
          },
          attachmentFileIds: fileIds,
          existingMessageIds,
          includeMessages: true,
          initialContext,
          prompt: message,
          reuseUserMessageId,
          // Forward the user's approval setting (auto-run / allow-list / manual)
          // so the server run honours it — otherwise it defaults to requiring
          // approval and pauses at human_approval even when the user picked auto.
          userInterventionConfig: {
            allowList: toolInterventionSelectors.allowList(getUserStoreState()),
            approvalMode: toolInterventionSelectors.approvalMode(getUserStoreState()),
          },
        },
        { signal: execAbortController.signal },
      );

      log(
        'execAgent result: operationId=%s, topicId=%s, success=%s',
        result.operationId,
        result.topicId,
        result.success,
      );

      const isCreateNewTopic = !inputTopicId && !!result.topicId;
      const execContext = { ...context, topicId: result.topicId || inputTopicId };

      // 3. Replace temp messages with the server's real messages. `messages` is
      //    only present because we passed `includeMessages: true` (narrow the
      //    enriched-vs-plain union via `in`).
      const syncedMessages = 'messages' in result ? result.messages : undefined;
      if (syncedMessages) {
        this.#get().replaceMessages(syncedMessages, {
          action: 'gateway/syncMessages',
          context: execContext,
        });
        this.#get().internal_dispatchMessage(
          { ids: tempIds, type: 'deleteMessages' },
          { operationId: execOperationId },
        );
      }

      // 4. Switch to + refresh the sidebar for a freshly-created topic.
      if (isCreateNewTopic && result.topicId) {
        await this.#get().switchTopic(result.topicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
        this.#get().refreshTopic();
      }

      // 5. Operation failed to start server-side (e.g. queue unavailable) — the
      //    assistant message already carries the error; skip the SSE connection.
      if (result.success === false) {
        log('Agent operation failed to start: %s', result.error);
        this.#get().failOperation(execOperationId, {
          message: result.error || 'Agent operation failed to start',
          type: 'AgentStartupError',
        });
        if (result.assistantMessageId)
          this.#get().internal_toggleMessageLoading(false, result.assistantMessageId);
        return;
      }

      // 6. Streaming context keyed on the server's real assistant message id.
      const streamContext = {
        assistantId: result.assistantMessageId,
        content: '',
        reasoning: '',
        tmpAssistantId: tempAssistantId,
      };

      // 7. Child operation for the SSE stream, using the backend operationId.
      //    Typed `execServerAgentRuntime` (an AI_RUNTIME container type) so the
      //    OpStatusTray recognises it as the active run — it's keyed on the
      //    switched-to topic context, unlike the parent op created before the
      //    topic switch. This also drives the inline loading label
      //    (`operation.execServerAgentRuntime`) instead of leaking a raw key.
      this.#get().startOperation({
        context: { ...execContext, messageId: result.assistantMessageId },
        label: 'Gateway Agent Stream',
        operationId: result.operationId,
        parentOperationId: execOperationId,
        type: 'execServerAgentRuntime',
      });

      this.#get().associateMessageWithOperation(result.assistantMessageId, execOperationId);
      this.#get().associateMessageWithOperation(result.assistantMessageId, result.operationId);

      // The round-trip is done and the stream op now owns the run status, so
      // complete the parent op here (it's keyed on the pre-switch `_new` context;
      // leaving it running would let the status tray resurface on a fresh topic).
      this.#get().completeOperation(execOperationId);

      // 8 + 9. Open the SSE stream (fresh run — no history replay) and wire the
      //         cancel handler. The event→store plumbing is shared with reconnect.
      this.#connectOperationStream(result.operationId, execContext, streamContext, {
        includeHistory: false,
      });
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('cancelled'));

      this.#get().internal_dispatchMessage(
        { ids: tempIds, type: 'deleteMessages' },
        { operationId: execOperationId },
      );

      if (isAbortError) {
        log('executeGatewayAgent aborted by user');
      } else {
        log('executeGatewayAgent failed: %O', error);
        console.error('Failed to execute gateway agent:', error);
        this.#get().failOperation(execOperationId, {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'ExecuteGatewayAgentError',
        });
      }
    } finally {
      if (!isRegenerate) this.#get().internal_toggleMessageLoading(false, tempUserId);
      this.#get().internal_toggleMessageLoading(false, tempAssistantId);
    }
  };

  /**
   * Open the SSE stream for a server operation and pipe its events into the chat
   * store via the shared `internal_handleAgentStreamEvent` plus a per-event
   * `resync`. TripYoYo's SSE events (unlike lobehub's WS gateway, which carry a
   * `uiMessages` snapshot) don't include the message list, and the shared handler
   * tracks a single `assistantId`, so we pull the authoritative messages and
   * replace — same effect as lobehub's `replaceMessages(uiMessages)`.
   *
   * Shared by `executeGatewayAgent` (fresh run → `includeHistory: false`) and
   * `reconnectToGatewayOperation` (re-attach to an in-flight run →
   * `includeHistory: true`, so the Redis stream replays events emitted before we
   * connected and the message catches up to current server state).
   *
   * Precondition: a local operation keyed on `operationId` must already exist —
   * `internal_handleAgentStreamEvent` drops events when the op is missing.
   */
  #connectOperationStream = (
    operationId: string,
    execContext: ConversationContext,
    streamContext: {
      assistantId: string;
      content: string;
      reasoning: string;
      tmpAssistantId: string;
    },
    { includeHistory }: { includeHistory: boolean },
  ) => {
    const { internal_handleAgentStreamEvent } = this.#get();

    const eventSource = agentRuntimeClient.createStreamConnection(operationId, {
      includeHistory,
      onConnect: () => log('Stream connected to %s', operationId),
      onDisconnect: () => {
        log('Stream disconnected from %s', operationId);
        this.#get().completeOperation(operationId);
      },
      onError: (error: Error) => {
        log('Stream error for %s: %O', operationId, error);
        this.#get().failOperation(operationId, {
          message: error.message,
          type: 'AgentStreamError',
        });
        if (streamContext.assistantId)
          this.#get().internal_handleAgentError(streamContext.assistantId, error.message);
      },
      onEvent: async (event: StreamEvent) => {
        // Pull the server's authoritative messages and replace (see method doc).
        const resync = async () => {
          try {
            const msgs = await messageService.getMessages(execContext);
            this.#get().replaceMessages(msgs, { action: 'gateway/resync', context: execContext });
          } catch (e) {
            log('gateway resync getMessages failed: %O', e);
          }
        };

        // A multi-step run creates a new assistant message each LLM turn.
        // Re-point the stream at it (and reset accumulators) so each turn's
        // chunks render live in the right message instead of all piling into
        // the first one — which otherwise shows the final answer out of order
        // until the next resync (a visible flicker). Pull the freshly-created
        // message into the store first so its chunks have somewhere to land.
        if (event.type === 'stream_start') {
          const newId = (event.data as { assistantMessage?: { id?: string } } | undefined)
            ?.assistantMessage?.id;
          if (newId && newId !== streamContext.assistantId) {
            await resync();
            streamContext.assistantId = newId;
            streamContext.content = '';
            streamContext.reasoning = '';
          }
        }

        await internal_handleAgentStreamEvent(operationId, event, streamContext);

        // Resync on `error` too: the shared handler stamps the frontend message
        // with a generic `UnknownError` (runAgent `internal_handleAgentError`),
        // discarding the typed error the server already persisted to
        // `messages.error` (e.g. `ProviderBizError` with provider/body). Pulling
        // the authoritative messages back restores the proper error card instead
        // of rendering the raw `response.UnknownError` i18n key.
        if (
          event.type === 'step_complete' ||
          event.type === 'agent_runtime_end' ||
          event.type === 'error'
        ) {
          await resync();
        }
      },
    });

    // Abort the SSE stream when the operation is cancelled.
    this.#get().onOperationCancel(operationId, () => {
      log('Cancelling SSE stream for operation %s', operationId);
      eventSource.abort();
    });

    return eventSource;
  };

  reconnectToGatewayOperation = async ({
    agentId,
    assistantMessageId,
    operationId,
    topicId,
  }: ReconnectToGatewayOperationParams): Promise<void> => {
    // Not gated on `agentGatewayUrl`: the SSE stream is the internal
    // `/api/agent/stream` endpoint, available regardless of gateway config.

    // Dedup: if this tab already owns a live op for this id (it started the run
    // via executeGatewayAgent, or an earlier reconnect is still streaming), skip
    // — a second SSE would duplicate every event into the message. 'paused' is an
    // active state too (mid-run human-approval), so it must not be re-attached.
    const existingOp = this.#get().operations[operationId];
    if (existingOp && (existingOp.status === 'running' || existingOp.status === 'paused')) {
      log('reconnect skipped: operation %s already active locally', operationId);
      return;
    }

    // Rebuild the EXACT context the task drawer reads from: `main` scope, this
    // agent, this topic, NO threadId. A threadId would flip the message-map key
    // to thread scope (`thread_…`) — a key the drawer never subscribes to — so
    // streamed updates would land off-screen. `scope`/`threadId` from params are
    // intentionally ignored here for that reason.
    const execContext: ConversationContext = { agentId, scope: 'main', topicId };

    // Anchor the op's startTime to the assistant message's createdAt so the
    // OpStatusTray elapsed timer doesn't reset to 0 on every reconnect. createdAt
    // can arrive as a Date/string after a DB rehydrate — normalize to epoch ms.
    const assistantMessage = Object.values(this.#get().messagesMap)
      .flat()
      .find((m) => m.id === assistantMessageId);
    const startTime = assistantMessage?.createdAt
      ? new Date(assistantMessage.createdAt).getTime()
      : undefined;

    log('reconnectToGatewayOperation: operationId=%s, topicId=%s', operationId, topicId);

    // Local op keyed on the SAME server operationId so loading state, dedup and
    // cancel routing all line up with executeGatewayAgent's stream op.
    this.#get().startOperation({
      context: { ...execContext, messageId: assistantMessageId },
      label: 'Gateway Agent Reconnect',
      metadata: Number.isFinite(startTime) ? { startTime } : undefined,
      operationId,
      type: 'execServerAgentRuntime',
    });
    this.#get().associateMessageWithOperation(assistantMessageId, operationId);
    this.#get().internal_toggleMessageLoading(true, assistantMessageId);

    // Show current DB state immediately, then attach the live stream with history
    // replay to catch up on events emitted before we connected.
    try {
      const msgs = await messageService.getMessages(execContext);
      this.#get().replaceMessages(msgs, { action: 'gateway/reconnect', context: execContext });
    } catch (e) {
      log('gateway reconnect initial getMessages failed: %O', e);
    }

    const streamContext = {
      assistantId: assistantMessageId,
      content: '',
      reasoning: '',
      tmpAssistantId: assistantMessageId,
    };
    this.#connectOperationStream(operationId, execContext, streamContext, { includeHistory: true });
  };
}

export type { GatewayAction as GatewayActionType };

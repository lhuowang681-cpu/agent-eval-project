/**
 * Shared setup helpers for the L3 contract scripts.
 *
 * Keeping the agent/topic/message boilerplate here means each script only expresses
 * what it is actually asserting.
 */
import { setScenario, trpcMutate, trpcQuery } from './client';

export interface RunContext {
  agentId: string;
  topicId: string;
  assistantMessageId: string;
  messages: any[];
}

/** Create a builtin-agent-backed topic with a user + assistant message pair. */
export const prepareConversation = async (title: string): Promise<RunContext> => {
  const agent = await trpcQuery<{ id: string }>('agent.getBuiltinAgent', { slug: 'inbox' });

  const topicId = await trpcMutate<string>('topic.createTopic', {
    agentId: agent.id,
    title: `${title} ${Date.now()}`,
  });

  const sent = await trpcMutate<any>('aiChat.sendMessageInServer', {
    agentId: agent.id,
    newAssistantMessage: { model: 'mock-model', provider: 'openai' },
    newUserMessage: { content: title },
    topicId,
  });

  return {
    agentId: agent.id,
    assistantMessageId: sent.assistantMessageId,
    messages: sent.messages ?? [],
    topicId,
  };
};

export const createOperation = async (
  ctx: RunContext,
  autoStart = true,
  extra: Record<string, unknown> = {},
) =>
  trpcMutate<any>('aiAgent.createOperation', {
    agentId: ctx.agentId,
    autoStart,
    messages: ctx.messages,
    modelRuntimeConfig: { model: 'mock-model', provider: 'openai' },
    topicId: ctx.topicId,
    ...extra,
  });

/**
 * Minimal manifest for `lobe-agent` carrying the `humanIntervention: 'always'`
 * policy on clearTodos, mirroring packages/builtin-tool-lobe-agent/src/manifest.ts:139.
 *
 * Needed because the server does not backfill manifests: AgentRuntimeService does
 * `const operationToolSet = toolSet` verbatim, and GeneralChatAgent reads the
 * intervention policy out of `state.toolManifestMap`.
 */
export const lobeAgentManifestWithApproval = {
  'lobe-agent': {
    api: [
      { description: 'Clear todo items.', humanIntervention: 'always', name: 'clearTodos', parameters: {} },
    ],
    identifier: 'lobe-agent',
    meta: { title: 'Lobe Agent' },
    type: 'builtin',
  },
};

export const getStatus = async (operationId: string, includeHistory = false) =>
  trpcQuery<any>('aiAgent.getOperationStatus', { includeHistory, operationId });

/** Poll getOperationStatus until it reaches a terminal/blocked status or times out. */
export const waitForStatus = async (
  operationId: string,
  predicate: (s: any) => boolean,
  { timeoutMs = 45_000, intervalMs = 300 } = {},
): Promise<any> => {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    last = await getStatus(operationId);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
};

export const isTerminal = (s: any) =>
  ['done', 'error', 'interrupted'].includes(s?.currentState?.status);

export const isBlocked = (s: any) =>
  ['waiting_for_human', 'waiting_for_async_tool'].includes(s?.currentState?.status);

/** Run one full agent turn under a given mock scenario and return the final status. */
export const runScenario = async (
  scenario: string,
  title: string,
  mockOverrides: Record<string, unknown> = {},
  /**
   * 透传给 createOperation 的额外入参（toolManifestMap / maxSteps / costLimit 等）。
   *
   * 加这个参数是因为 manifest 缺失现在会被 fail-closed 拦成待审批
   * （附录 C-1 的修复），需要工具真正执行的场景必须能声明 manifest。
   */
  operationExtra: Record<string, unknown> = {},
) => {
  await setScenario(scenario, { firstTokenDelayMs: 0, tokensPerSecond: 0, ...mockOverrides });
  const ctx = await prepareConversation(title);
  const op = await createOperation(ctx, true, operationExtra);
  const status = await waitForStatus(op.operationId, (s) => isTerminal(s) || isBlocked(s));
  return { ctx, op, status };
};

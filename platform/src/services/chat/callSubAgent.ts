import { type CallSubAgentParams, type CallSubAgentState } from '@lobechat/builtin-tool-lobe-agent';
import { type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { sleep } from '@/utils/sleep';

const DEFAULT_TIMEOUT = 1_800_000; // 30 minutes
const POLL_INTERVAL = 3000; // 3 seconds

const nestedSubAgentDisabledResult = (): BuiltinToolResult => ({
  content: 'Sub-agent calls cannot be triggered from within another sub-agent.',
  error: { message: 'Nested sub-agent calls are not allowed.', type: 'NestedSubAgentNotAllowed' },
  success: false,
});

/**
 * Client-side implementation of `lobe-agent`'s `callSubAgent` API.
 *
 * TripYoYo's interactive chat runs entirely in the browser tab
 * (`internal_execAgentRuntime`) — the parent operation is never persisted,
 * so there is nothing to "park". This synchronously awaits the sub-agent to
 * completion, which is functionally equivalent to GTD's `execTask` poll
 * loop, just packaged as a single blocking call instead of a two-step
 * `stop:true` + external-poll dance.
 *
 * Not yet wired into a builtin tool executor (the `lobe-agent` tool doesn't
 * exist yet — that's C4). The server-side counterpart (for headless/gateway
 * parents, which DO persist operation state) uses a deferred/suspend-bridge
 * model instead — see `src/server/services/toolExecution/serverRuntimes/gtd.ts`.
 */
export const callSubAgent = async (
  params: CallSubAgentParams,
  ctx: BuiltinToolContext,
): Promise<BuiltinToolResult> => {
  if (ctx.isSubAgent) return nestedSubAgentDisabledResult();

  const { description, instruction, timeout } = params;

  if (!description?.trim() || !instruction?.trim()) {
    return {
      error: {
        message: '`description` and `instruction` are required.',
        type: 'InvalidToolArguments',
      },
      success: false,
    };
  }

  if (!ctx.agentId || !ctx.topicId) {
    return {
      content: 'Sub-agent execution is not available outside of a topic conversation.',
      error: { message: 'Missing agentId/topicId context.', type: 'SubAgentContextUnavailable' },
      success: false,
    };
  }

  const { aiAgentService } = await import('@/services/aiAgent');

  const createResult = await aiAgentService.execSubAgentTask({
    agentId: ctx.agentId,
    instruction,
    parentMessageId: ctx.messageId,
    timeout,
    title: description,
    topicId: ctx.topicId,
  });

  if (!createResult.success) {
    return {
      content: `Sub-agent failed to start: ${createResult.error ?? 'unknown error'}`,
      error: {
        message: createResult.error ?? 'Sub-agent failed to start.',
        type: 'SubAgentStartFailed',
      },
      success: false,
    };
  }

  const { threadId } = createResult;
  const maxWait = timeout || DEFAULT_TIMEOUT;
  const startTime = Date.now();

  const interruptQuietly = async () => {
    try {
      await aiAgentService.interruptTask({ threadId });
    } catch {
      // best-effort — the task may have already finished
    }
  };

  while (Date.now() - startTime < maxWait) {
    if (ctx.signal?.aborted) {
      await interruptQuietly();
      return { stop: true, success: false };
    }

    const status = await aiAgentService.getSubAgentTaskStatus({ threadId });

    if (status.status === 'completed') {
      return {
        content: status.result || 'Sub-agent completed without a textual answer.',
        state: { status: 'completed', threadId } satisfies CallSubAgentState,
        success: true,
      };
    }

    if (status.status === 'failed') {
      return {
        content: `Sub-agent did not complete: ${status.error ?? 'unknown error'}`,
        error: {
          message: status.error ?? 'Sub-agent execution failed.',
          type: 'PluginServerError',
        },
        state: { status: 'error', threadId } satisfies CallSubAgentState,
        success: false,
      };
    }

    if (status.status === 'cancel') {
      return {
        content: 'Sub-agent task was cancelled.',
        state: { status: 'error', threadId } satisfies CallSubAgentState,
        success: false,
      };
    }

    if (ctx.signal?.aborted) {
      await interruptQuietly();
      return { stop: true, success: false };
    }

    await sleep(POLL_INTERVAL);
  }

  await interruptQuietly();

  return {
    content: `Sub-agent task timed out after ${maxWait}ms.`,
    error: { message: 'Sub-agent task timed out.', type: 'SubAgentTimeout' },
    state: { status: 'error', threadId } satisfies CallSubAgentState,
    success: false,
  };
};

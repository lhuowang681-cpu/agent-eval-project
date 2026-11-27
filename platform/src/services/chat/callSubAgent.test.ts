import { type BuiltinToolContext } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callSubAgent } from './callSubAgent';

const mockExecSubAgentTask = vi.fn();
const mockGetSubAgentTaskStatus = vi.fn();
const mockInterruptTask = vi.fn();

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execSubAgentTask: (...args: unknown[]) => mockExecSubAgentTask(...args),
    getSubAgentTaskStatus: (...args: unknown[]) => mockGetSubAgentTaskStatus(...args),
    interruptTask: (...args: unknown[]) => mockInterruptTask(...args),
  },
}));

const mockSleep = vi.fn();
vi.mock('@/utils/sleep', () => ({
  sleep: (...args: unknown[]) => mockSleep(...args),
}));

const baseCtx: BuiltinToolContext = {
  agentId: 'agent-1',
  messageId: 'tool-msg-1',
  topicId: 'topic-1',
};

let now = 0;

beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mockInterruptTask.mockResolvedValue({ success: true });
  mockSleep.mockImplementation(async () => {
    now += 100;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('callSubAgent (client)', () => {
  it('rejects nested sub-agent dispatch', async () => {
    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      { ...baseCtx, isSubAgent: true },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('NestedSubAgentNotAllowed');
    expect(mockExecSubAgentTask).not.toHaveBeenCalled();
  });

  it('fails when description or instruction is missing', async () => {
    const result = await callSubAgent({ description: '', instruction: 'do research' }, baseCtx);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
  });

  it('fails when agentId/topicId context is unavailable', async () => {
    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('SubAgentContextUnavailable');
    expect(mockExecSubAgentTask).not.toHaveBeenCalled();
  });

  it('fails when the sub-agent fails to start', async () => {
    mockExecSubAgentTask.mockResolvedValue({ error: 'agent not found', success: false });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      baseCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('SubAgentStartFailed');
    expect(mockGetSubAgentTaskStatus).not.toHaveBeenCalled();
  });

  it('resolves successfully once the sub-agent completes', async () => {
    mockExecSubAgentTask.mockResolvedValue({
      assistantMessageId: 'msg-2',
      operationId: 'op-1',
      success: true,
      threadId: 'thread-1',
    });
    mockGetSubAgentTaskStatus
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ result: 'The answer is 42.', status: 'completed' });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      baseCtx,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('The answer is 42.');
    expect(result.state).toMatchObject({ status: 'completed', threadId: 'thread-1' });
  });

  it('returns a plugin error when the sub-agent fails', async () => {
    mockExecSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-1' });
    mockGetSubAgentTaskStatus.mockResolvedValueOnce({ error: 'boom', status: 'failed' });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      baseCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('PluginServerError');
  });

  it('resolves as failure when the sub-agent task is cancelled server-side', async () => {
    mockExecSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-1' });
    mockGetSubAgentTaskStatus.mockResolvedValueOnce({ status: 'cancel' });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      baseCtx,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('cancelled');
  });

  it('stops without an error when the signal is already aborted before starting to poll', async () => {
    mockExecSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-1' });
    const controller = new AbortController();
    controller.abort();

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      { ...baseCtx, signal: controller.signal },
    );

    expect(result.stop).toBe(true);
    expect(result.success).toBe(false);
    expect(mockInterruptTask).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });

  it('stops and interrupts the task when the signal aborts mid-poll', async () => {
    mockExecSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-1' });
    const controller = new AbortController();
    mockGetSubAgentTaskStatus.mockImplementation(async () => {
      controller.abort();
      return { status: 'processing' };
    });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research' },
      { ...baseCtx, signal: controller.signal },
    );

    expect(result.stop).toBe(true);
    expect(mockInterruptTask).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });

  it('times out and interrupts the task after exceeding the max wait', async () => {
    mockExecSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-1' });
    mockGetSubAgentTaskStatus.mockResolvedValue({ status: 'processing' });

    const result = await callSubAgent(
      { description: 'research', instruction: 'do research', timeout: 250 },
      baseCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('SubAgentTimeout');
    expect(mockInterruptTask).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });
});

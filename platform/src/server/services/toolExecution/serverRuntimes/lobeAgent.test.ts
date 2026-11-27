import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lobeAgentRuntime } from './lobeAgent';

vi.mock('@/database/models/document');
vi.mock('@/database/models/topicDocument');

const mockMessageCreate = vi.fn();
const mockDeleteMessage = vi.fn();
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: (...args: unknown[]) => mockMessageCreate(...args),
    deleteMessage: (...args: unknown[]) => mockDeleteMessage(...args),
  })),
}));

const mockExecVirtualSubAgent = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execVirtualSubAgent: (...args: unknown[]) => mockExecVirtualSubAgent(...args),
  })),
}));

describe('lobeAgentRuntime', () => {
  it('should have correct identifier', () => {
    expect(lobeAgentRuntime.identifier).toBe('lobe-agent');
  });

  it('should create runtime from factory with valid context', () => {
    const context = {
      serverDB: {} as any,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    };

    const runtime = lobeAgentRuntime.factory(context);

    expect(runtime).toBeDefined();
    expect(typeof runtime.createPlan).toBe('function');
    expect(typeof runtime.updatePlan).toBe('function');
    expect(typeof runtime.createTodos).toBe('function');
    expect(typeof runtime.updateTodos).toBe('function');
    expect(typeof runtime.clearTodos).toBe('function');
    expect(typeof runtime.execTask).toBe('function');
    expect(typeof runtime.execTasks).toBe('function');
    expect(typeof runtime.analyzeVisualMedia).toBe('function');
    expect(typeof runtime.callSubAgent).toBe('function');
  });

  it('should throw if userId is missing', () => {
    const context = { serverDB: {} as any, toolManifestMap: {} };

    expect(() => lobeAgentRuntime.factory(context)).toThrow(
      'userId and serverDB are required for lobe-agent execution',
    );
  });

  it('should throw if serverDB is missing', () => {
    const context = { toolManifestMap: {}, userId: 'user-1' };

    expect(() => lobeAgentRuntime.factory(context)).toThrow(
      'userId and serverDB are required for lobe-agent execution',
    );
  });

  it('execTask does not require a database call (pure trigger builder)', async () => {
    const context = { serverDB: {} as any, toolManifestMap: {}, userId: 'user-1' };
    const runtime = lobeAgentRuntime.factory(context);

    const result = await runtime.execTask({ description: 'do it', instruction: 'do it' });

    expect(result.success).toBe(true);
    expect(result.stop).toBe(true);
    expect(result.state?.type).toBe('execTask');
  });

  describe('callSubAgent', () => {
    const baseContext = {
      agentId: 'agent-1',
      messageId: 'assistant-msg-1',
      operationId: 'op-1',
      serverDB: {} as any,
      toolCallId: 'call-1',
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockMessageCreate.mockResolvedValue({ id: 'tool-msg-1' });
    });

    it('rejects nested sub-agent dispatch', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);

      const result = await runtime.callSubAgent(
        { description: 'research', instruction: 'do research' },
        { ...baseContext, isSubAgent: true },
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('NESTED_SUB_AGENT_NOT_ALLOWED');
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });

    it('fails when description or instruction is missing', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);

      const result = await runtime.callSubAgent(
        { description: '', instruction: 'do research' },
        baseContext,
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('INVALID_ARGUMENTS');
    });

    it('fails when required context is unavailable', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);

      const result = await runtime.callSubAgent(
        { description: 'research', instruction: 'do research' },
        { serverDB: {} as any, toolManifestMap: {}, userId: 'user-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('SUB_AGENT_CONTEXT_UNAVAILABLE');
      expect(mockMessageCreate).not.toHaveBeenCalled();
    });

    it('creates a placeholder message and returns a deferred result on success', async () => {
      mockExecVirtualSubAgent.mockResolvedValue({
        operationId: 'sub-op-1',
        success: true,
        threadId: 'thread-1',
      });

      const runtime = lobeAgentRuntime.factory(baseContext);
      const result = await runtime.callSubAgent(
        { description: 'research', instruction: 'do research' },
        baseContext,
      );

      expect(mockMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'assistant-msg-1',
          pluginState: { status: 'pending' },
          role: 'tool',
          tool_call_id: 'call-1',
        }),
      );
      expect(mockExecVirtualSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          parentMessageId: 'tool-msg-1',
          parentOperationId: 'op-1',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.deferred).toBe(true);
      expect(result.state).toMatchObject({
        status: 'pending',
        subOperationId: 'sub-op-1',
        threadId: 'thread-1',
        toolMessageId: 'tool-msg-1',
      });
    });

    it('cleans up the placeholder and returns an error when the sub-agent fails to start', async () => {
      mockExecVirtualSubAgent.mockResolvedValue({ error: 'agent not found', success: false });

      const runtime = lobeAgentRuntime.factory(baseContext);
      const result = await runtime.callSubAgent(
        { description: 'research', instruction: 'do research' },
        baseContext,
      );

      expect(mockDeleteMessage).toHaveBeenCalledWith('tool-msg-1');
      expect(result.success).toBe(false);
      expect(result.deferred).toBeUndefined();
      expect(result.error?.type).toBe('SUB_AGENT_START_FAILED');
    });
  });
});

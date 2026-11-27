import { describe, expect, it, vi } from 'vitest';

import { AgentDocumentsExecutionRuntime } from './index';

describe('AgentDocumentsExecutionRuntime.createDocument', () => {
  it('fails when there is no agentId in context', async () => {
    const runtime = new AgentDocumentsExecutionRuntime({
      copyDocument: async () => undefined,
      createDocument: vi.fn(),
      editDocument: async () => undefined,
      readDocument: async () => undefined,
      removeDocument: async () => false,
      renameDocument: async () => undefined,
      updateLoadRule: async () => undefined,
    });

    const result = await runtime.createDocument({ content: 'c', title: 't' }, {});

    expect(result.success).toBe(false);
  });

  it('fails when scope is currentTopic but no topicId is present in context', async () => {
    const createDocument = vi.fn();
    const runtime = new AgentDocumentsExecutionRuntime({
      copyDocument: async () => undefined,
      createDocument,
      editDocument: async () => undefined,
      readDocument: async () => undefined,
      removeDocument: async () => false,
      renameDocument: async () => undefined,
      updateLoadRule: async () => undefined,
    });

    const result = await runtime.createDocument(
      { content: 'c', scope: 'currentTopic', title: 't' },
      { agentId: 'agent-1' },
    );

    expect(result.success).toBe(false);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('passes topicId through when scope is currentTopic and topicId is present', async () => {
    const createDocument = vi.fn().mockResolvedValue({ content: 'c', id: 'doc-1', title: 't' });
    const runtime = new AgentDocumentsExecutionRuntime({
      copyDocument: async () => undefined,
      createDocument,
      editDocument: async () => undefined,
      readDocument: async () => undefined,
      removeDocument: async () => false,
      renameDocument: async () => undefined,
      updateLoadRule: async () => undefined,
    });

    const result = await runtime.createDocument(
      { content: 'c', scope: 'currentTopic', title: 't' },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'c',
      scope: 'currentTopic',
      title: 't',
      topicId: 'topic-1',
    });
  });

  it('does not pass topicId when scope is agent (default)', async () => {
    const createDocument = vi.fn().mockResolvedValue({ content: 'c', id: 'doc-1', title: 't' });
    const runtime = new AgentDocumentsExecutionRuntime({
      copyDocument: async () => undefined,
      createDocument,
      editDocument: async () => undefined,
      readDocument: async () => undefined,
      removeDocument: async () => false,
      renameDocument: async () => undefined,
      updateLoadRule: async () => undefined,
    });

    await runtime.createDocument(
      { content: 'c', title: 't' },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'c',
      title: 't',
      topicId: undefined,
    });
  });
});

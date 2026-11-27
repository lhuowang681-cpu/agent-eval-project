import { ChatErrorType, type ChatMessageError } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';

import { createCallLLMInstruction, createMockStore, createUserMessage } from './fixtures';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

// Mock external services at module level (mirrors call-llm.test.ts)
vi.mock('@/services/chat', () => ({
  chatService: {
    createAssistantMessageStream: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    updateMessage: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopicSummary: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: vi.fn().mockReturnValue({
    uploadBase64FileWithProgress: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {},
}));

vi.mock('@/store/agent/store', () => ({
  getAgentStoreState: vi.fn().mockReturnValue({}),
}));

/**
 * The exact error shape fetchSSE emits when a connection drops *after* streaming
 * has started (e.g. gateway idle-timeout / network blip). Note: no `body.reason`
 * — recovery must key off `type === ConnectionAborted`.
 */
const connectionAbortedError: ChatMessageError = {
  body: { message: 'network error', name: 'TypeError', stack: 'TypeError: network error' },
  message: 'Connection aborted during streaming',
  type: ChatErrorType.ConnectionAborted,
};

/**
 * Simulate a stream that emits `partialContent`, then drops mid-stream with
 * ConnectionAborted, then still calls onFinish with type 'error'.
 *
 * This mirrors real fetchSSE behaviour: because the HTTP response (200) was
 * received before the drop, fetchSSE reaches its `response.ok` branch and DOES
 * call onFinish — which is what lets createAgentExecutors run its auto-continue
 * logic instead of just surfacing a dead error.
 */
const mockAbortedStream = (partialContent: string) => {
  vi.mocked(chatService.createAssistantMessageStream).mockImplementation(async (params: any) => {
    if (partialContent && params.onMessageHandle) {
      await params.onMessageHandle({ type: 'text', text: partialContent });
    }
    await params.onErrorHandle?.(connectionAbortedError);
    await params.onFinish?.(partialContent, { type: 'error' });
  });
};

const createRecoveryMockStore = () =>
  createMockStore({
    internal_execAgentRuntime: vi.fn().mockResolvedValue(undefined),
    optimisticUpdateMessageMetadata: vi.fn().mockResolvedValue(undefined),
  } as any);

describe('call_llm executor — ConnectionAborted stream recovery', () => {
  it('auto-continues the partial answer instead of surfacing a dead error', async () => {
    // Given a stream that already produced HTML, then the connection dropped
    const mockStore = createRecoveryMockStore();
    const context = createTestContext();
    const instruction = createCallLLMInstruction({
      messages: [createUserMessage({ content: 'write a long html report' })],
      model: 'gpt-4',
      provider: 'openai',
    });
    const state = createInitialState();

    mockAbortedStream('<!DOCTYPE html><html><body><h1>partial');
    mockStore.dbMessagesMap[context.messageKey] = [];

    // When
    await executeWithMockContext({ executor: 'call_llm', instruction, state, mockStore, context });

    // Then: no dead error is written, and a stream continuation is kicked off
    expect(mockStore.optimisticUpdateMessageError).not.toHaveBeenCalled();
    expect(mockStore.internal_execAgentRuntime).toHaveBeenCalledTimes(1);
    expect(mockStore.internal_execAgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreamContinue: true,
        parentMessageType: 'assistant',
        skipCreateFirstMessage: true,
      }),
    );
  });

  it('marks the message incomplete (shows the continue banner) when continuation adds nothing', async () => {
    // Given the continuation does not add any content (internal_execAgentRuntime is a no-op)
    const mockStore = createRecoveryMockStore();
    const context = createTestContext();
    const instruction = createCallLLMInstruction({
      messages: [createUserMessage()],
      model: 'gpt-4',
      provider: 'openai',
    });
    const state = createInitialState();

    mockAbortedStream('<!DOCTYPE html><html><body><h1>partial');
    mockStore.dbMessagesMap[context.messageKey] = [];

    // When
    await executeWithMockContext({ executor: 'call_llm', instruction, state, mockStore, context });

    // Then: message is flagged incomplete so IncompleteStreamBanner offers "continue generation"
    expect(mockStore.optimisticUpdateMessageMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ autoRetryExhausted: true, isIncomplete: true }),
      expect.objectContaining({ operationId: expect.any(String) }),
    );
  });

  it('does NOT auto-continue when the drop happens before any content streamed', async () => {
    // Given the connection died before a single chunk arrived — the lower
    // fetchSSE network-retry owns this case; here it must stay a plain error.
    const mockStore = createRecoveryMockStore();
    const context = createTestContext();
    const instruction = createCallLLMInstruction({
      messages: [createUserMessage()],
      model: 'gpt-4',
      provider: 'openai',
    });
    const state = createInitialState();

    mockAbortedStream(''); // no content before the drop
    mockStore.dbMessagesMap[context.messageKey] = [];

    // When
    await executeWithMockContext({ executor: 'call_llm', instruction, state, mockStore, context });

    // Then: no continuation, error is surfaced normally
    expect(mockStore.internal_execAgentRuntime).not.toHaveBeenCalled();
    expect(mockStore.optimisticUpdateMessageError).toHaveBeenCalled();
  });
});

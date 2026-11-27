import { createVisualFileRef } from '@lobechat/const/visualRef';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeVisualMedia } from './analyzeVisualMedia';

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    visualUnderstanding: (s: any) => s.serverConfig?.visualUnderstanding,
  },
}));

const mockGetChatCompletion = vi.fn();
vi.mock('@/services/chat', () => ({
  chatService: {
    getChatCompletion: (...args: unknown[]) => mockGetChatCompletion(...args),
  },
}));

const mockGetDbMessageById = vi.fn();
const mockLatestUserMessage = vi.fn();
const mockActiveDbMessages = vi.fn();
vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({}),
}));
vi.mock('@/store/chat/selectors', () => ({
  dbMessageSelectors: {
    activeDbMessages: (s: any) => mockActiveDbMessages(s),
    getDbMessageById: (id: string) => (s: any) => mockGetDbMessageById(id, s),
    latestUserMessage: (s: any) => mockLatestUserMessage(s),
  },
}));

const setVisualUnderstandingConfig = (config?: { model: string; provider: string }) => {
  (window as any).global_serverConfigStore = {
    getState: () => ({ serverConfig: { visualUnderstanding: config } }),
  };
};

const userImageMessage = {
  id: 'msg-user-1',
  imageList: [{ alt: 'photo.png', id: 'file-1', url: 'https://example.com/photo.png' }],
  role: 'user',
  videoList: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  setVisualUnderstandingConfig({ model: 'gpt-4o', provider: 'openai' });
  mockGetDbMessageById.mockReturnValue(undefined);
  mockLatestUserMessage.mockReturnValue(userImageMessage);
  mockActiveDbMessages.mockReturnValue([userImageMessage]);
});

afterEach(() => {
  delete (window as any).global_serverConfigStore;
});

describe('analyzeVisualMedia (client)', () => {
  it('fails when visual understanding is not configured', async () => {
    setVisualUnderstandingConfig(undefined);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/x.png'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('PluginSettingsInvalid');
  });

  it('fails when question is missing', async () => {
    const result = await analyzeVisualMedia(
      { question: '', urls: ['https://example.com/x.png'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
  });

  it('fails when neither refs nor urls are provided', async () => {
    const result = await analyzeVisualMedia(
      { question: 'what is this?' },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
  });

  it('fails on unsupported urls', async () => {
    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['ftp://example.com/image.png'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
  });

  it('fails when no visual files are found for the requested refs', async () => {
    mockLatestUserMessage.mockReturnValue(undefined);
    mockActiveDbMessages.mockReturnValue([]);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['image_1'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('VisualFilesNotFound');
  });

  it('resolves visual files by direct urls without touching the chat store', async () => {
    mockGetChatCompletion.mockImplementation(async (_payload, options) => {
      await options.onMessageHandle({ text: 'A sunset.', type: 'text' });
      await options.onFinish('A sunset.', { usage: { totalTokens: 10 } });
    });

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/sunset.png'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('A sunset.');
    expect(mockActiveDbMessages).not.toHaveBeenCalled();
  });

  it('resolves visual files by ref from the latest user message', async () => {
    mockGetChatCompletion.mockImplementation(async (_payload, options) => {
      await options.onFinish('It is a cat.', { usage: undefined });
    });

    const ref = createVisualFileRef({
      index: 0,
      messageId: userImageMessage.id,
      type: 'image',
    });

    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: [ref] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('It is a cat.');
  });

  it('fails when the requested ref is unknown', async () => {
    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['unknown_ref'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
  });

  it('propagates chat completion errors', async () => {
    mockGetChatCompletion.mockImplementation(async (_payload, options) => {
      await options.onErrorHandle({ message: 'boom' });
    });

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/sunset.png'] },
      { messageId: 'tool-msg-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('PluginServerError');
  });

  it('stops without an error when the signal is already aborted', async () => {
    mockGetChatCompletion.mockResolvedValue(undefined);
    const controller = new AbortController();
    controller.abort();

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/sunset.png'] },
      { messageId: 'tool-msg-1', signal: controller.signal },
    );

    expect(result.stop).toBe(true);
    expect(result.success).toBe(false);
  });
});

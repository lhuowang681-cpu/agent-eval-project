import { createVisualFileRef } from '@lobechat/const/visualRef';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import { analyzeVisualMedia } from './lobeAgentVisualMedia';

vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    VISUAL_UNDERSTANDING_MODEL: 'gpt-4o',
    VISUAL_UNDERSTANDING_PROVIDER: 'openai',
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      { abilities: { vision: true }, id: 'gpt-4o', providerId: 'openai' },
      { abilities: { vision: false }, id: 'gpt-3.5-turbo', providerId: 'openai' },
    ],
  };
});

const context = { messageId: 'msg-1', serverDB: {} as any, topicId: 'topic-1', userId: 'user-1' };

const userImageMessage = {
  id: 'msg-user-1',
  imageList: [{ alt: 'photo.png', id: 'file-1', url: 'https://example.com/photo.png' }],
  role: 'user',
  videoList: [],
};

describe('analyzeVisualMedia', () => {
  const mockMessageModel = {
    query: vi.fn(),
    queryByIds: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (FileService as any).mockImplementation(() => ({
      getFileAccessUrl: vi.fn().mockResolvedValue('https://example.com/photo.png'),
    }));
    (MessageModel as any).mockImplementation(() => mockMessageModel);
    (toolsEnv as any).VISUAL_UNDERSTANDING_MODEL = 'gpt-4o';
    (toolsEnv as any).VISUAL_UNDERSTANDING_PROVIDER = 'openai';
  });

  it('fails when visual understanding is not configured', async () => {
    (toolsEnv as any).VISUAL_UNDERSTANDING_MODEL = undefined;

    const result = await analyzeVisualMedia({ question: 'what is this?' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VISUAL_UNDERSTANDING_NOT_CONFIGURED');
  });

  it('fails when question is missing', async () => {
    const result = await analyzeVisualMedia({ question: '' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  });

  it('fails when neither refs nor urls are provided', async () => {
    const result = await analyzeVisualMedia({ question: 'what is this?' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  });

  it('fails on unsupported urls', async () => {
    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['ftp://example.com/image.png'] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_VISUAL_MEDIA_URLS');
  });

  it('fails when refs are requested without a source message', async () => {
    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['image_1'] },
      { ...context, messageId: undefined },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SOURCE_MESSAGE_NOT_FOUND');
  });

  it('fails when the source message does not exist', async () => {
    mockMessageModel.queryByIds.mockResolvedValue([]);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['image_1'] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SOURCE_MESSAGE_NOT_FOUND');
  });

  it('fails when no visual files are attached', async () => {
    mockMessageModel.queryByIds.mockResolvedValue([{ ...userImageMessage, imageList: [] }]);
    mockMessageModel.query.mockResolvedValue([]);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['image_1'] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_VISUAL_FILES');
  });

  it('fails when the requested ref is unknown', async () => {
    mockMessageModel.queryByIds.mockResolvedValue([userImageMessage]);
    mockMessageModel.query.mockResolvedValue([userImageMessage]);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', refs: ['missing_ref'] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_VISUAL_FILE_REFS');
  });

  it('fails when the configured model does not support vision', async () => {
    (toolsEnv as any).VISUAL_UNDERSTANDING_MODEL = 'gpt-3.5-turbo';

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/photo.png'] },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VISUAL_MODEL_IMAGE_UNSUPPORTED');
  });

  it('analyzes visual files selected by ref and returns the model output', async () => {
    mockMessageModel.queryByIds.mockResolvedValue([userImageMessage]);
    mockMessageModel.query.mockResolvedValue([userImageMessage]);

    const chat = vi.fn().mockImplementation(async (_payload, options) => {
      await options.callback.onText('It is a cat.');
      await options.callback.onCompletion({ usage: { totalTokens: 42 } });
      return {};
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);

    const result = await analyzeVisualMedia(
      {
        question: 'what is this?',
        refs: [createVisualFileRef({ index: 0, messageId: userImageMessage.id, type: 'image' })],
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('It is a cat.');
    expect(result.state?.files).toHaveLength(1);
    expect(result.state?.model).toBe('gpt-4o');
    expect(result.state?.provider).toBe('openai');
    expect(result.state?.usage).toEqual({ totalTokens: 42 });
  });

  it('analyzes visual files selected by direct url without needing a source message', async () => {
    const chat = vi.fn().mockImplementation(async (_payload, options) => {
      await options.callback.onText('A sunset.');
      return {};
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat } as any);

    const result = await analyzeVisualMedia(
      { question: 'what is this?', urls: ['https://example.com/sunset.png'] },
      { ...context, messageId: undefined },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('A sunset.');
    expect(mockMessageModel.queryByIds).not.toHaveBeenCalled();
  });
});

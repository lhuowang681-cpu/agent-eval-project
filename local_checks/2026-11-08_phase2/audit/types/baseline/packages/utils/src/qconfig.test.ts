import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMemoryAnalysisTaskConfig,
  getQConfig,
  getQConfigAiInfraConfig,
  getQConfigAnnouncementConfig,
  getQConfigAppConfig,
  getQConfigProviderAccess,
  getQConfigProviderRuntime,
  getQConfigServiceModelTask,
  resolveQConfigProviderModels,
  resolveServiceModelCredential,
} from './qconfig';

vi.mock('./qconfig/index.js', () => ({
  getQConfig: vi.fn(),
}));

describe('qconfig ai infra resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the unified ai infra config', () => {
    vi.mocked(getQConfig).mockReturnValue({
      providers: {},
    });

    expect(getQConfigAiInfraConfig()).toEqual({
      providers: {},
    });
    expect(getQConfig).toHaveBeenCalledWith('ai-infra-config.json');
  });

  it('reads app announcement config', () => {
    vi.mocked(getQConfig).mockReturnValue({
      announcement: {
        enabled: true,
        level: 'warning',
        message: 'Use Peta after access authorization.',
        title: 'Peta notice',
      },
    });

    expect(getQConfigAppConfig()).toEqual({
      announcement: {
        enabled: true,
        level: 'warning',
        message: 'Use Peta after access authorization.',
        title: 'Peta notice',
      },
    });
    expect(getQConfigAnnouncementConfig()).toEqual({
      enabled: true,
      level: 'warning',
      message: 'Use Peta after access authorization.',
      title: 'Peta notice',
    });
    expect(getQConfig).toHaveBeenCalledWith('app-config.json');
  });

  it('ignores disabled or empty announcement config', () => {
    vi.mocked(getQConfig).mockReturnValue({
      announcement: {
        enabled: true,
        message: '   ',
      },
    });

    expect(getQConfigAnnouncementConfig()).toBeUndefined();

    vi.mocked(getQConfig).mockReturnValue({
      announcement: {
        enabled: false,
        message: 'Use Peta after access authorization.',
      },
    });

    expect(getQConfigAnnouncementConfig()).toBeUndefined();
  });

  it('resolves image model parameters with custom size capability from model registry', () => {
    vi.mocked(getQConfig).mockReturnValue({
      modelRegistry: {
        'gpt-image-2': {
          displayName: 'GPT Image 2',
          id: 'gpt-image-2',
          parameters: {
            prompt: { default: '' },
            size: {
              default: 'auto',
              enum: ['auto', '1024x1024', '1536x1024', '1024x1536', 'custom'],
            },
          },
          type: 'image',
        },
      },
      providers: {
        tripflow: {
          enabledModels: ['gpt-image-2'],
          models: ['gpt-image-2'],
        },
      },
    });

    expect(resolveQConfigProviderModels('tripflow')).toEqual([
      expect.objectContaining({
        enabled: true,
        id: 'gpt-image-2',
        parameters: {
          prompt: { default: '' },
          size: {
            default: 'auto',
            enum: ['auto', '1024x1024', '1536x1024', '1024x1536', 'custom'],
          },
        },
        type: 'image',
      }),
    ]);
  });

  it('resolves provider models from model registry and overrides', () => {
    vi.mocked(getQConfig).mockReturnValue({
      modelRegistry: {
        'claude-sonnet-4-6': {
          abilities: { reasoning: true, vision: true },
          contextWindowTokens: 1_000_000,
          displayName: 'Claude Sonnet 4.6',
          id: 'claude-sonnet-4-6',
          settings: {
            devParams: {
              temperature: { default: 0.7, enabled: true },
            },
            extendParams: ['enableAdaptiveThinking'],
          },
          type: 'chat',
        },
      },
      providers: {
        tripflow: {
          enabledModels: ['claude-sonnet-4-6'],
          modelOverrides: {
            'claude-sonnet-4-6': {
              settings: {
                extendParams: ['enableReasoning'],
              },
            },
          },
          models: ['claude-sonnet-4-6'],
        },
      },
    });

    expect(resolveQConfigProviderModels('tripflow')).toEqual([
      {
        abilities: { reasoning: true, vision: true },
        contextWindowTokens: 1_000_000,
        displayName: 'Claude Sonnet 4.6',
        enabled: true,
        id: 'claude-sonnet-4-6',
        settings: {
          devParams: {
            temperature: { default: 0.7, enabled: true },
          },
          extendParams: ['enableReasoning'],
        },
        type: 'chat',
      },
    ]);
  });

  it('resolves service model tasks and validates builtin credential', () => {
    vi.mocked(getQConfig).mockReturnValue({
      runtime: {
        tripflow: {
          apiKey: 'sk-tripflow',
          baseURL: 'https://tripflow.example/v1',
        },
      },
      serviceModel: {
        defaultAgent: { model: 'claude-sonnet-4-6', provider: 'ada' },
        systemAgent: {
          topic: {
            credential: 'builtin',
            model: 'DeepSeek-V4-Flash',
            provider: 'tripflow',
          },
        },
      },
    });

    expect(getQConfigServiceModelTask('topic')).toEqual({
      credential: 'builtin',
      model: 'DeepSeek-V4-Flash',
      provider: 'tripflow',
    });
    expect(resolveServiceModelCredential('tripflow')).toBe('builtin');
    expect(resolveServiceModelCredential('ada', 'builtin')).toBe('user');
    expect(resolveServiceModelCredential('openai', 'builtin')).toBe('user');
  });

  it('resolves memoryAnalysis task from systemAgent service model config', () => {
    vi.mocked(getQConfig).mockReturnValue({
      serviceModel: {
        systemAgent: {
          memoryAnalysis: {
            credential: 'builtin',
            model: 'DeepSeek-V4-Flash',
            provider: 'tripflow',
          },
        },
      },
    });

    expect(getMemoryAnalysisTaskConfig()).toEqual({
      credential: 'builtin',
      model: 'DeepSeek-V4-Flash',
      provider: 'tripflow',
    });
    expect(getQConfigServiceModelTask('memoryAnalysis')).toEqual({
      credential: 'builtin',
      model: 'DeepSeek-V4-Flash',
      provider: 'tripflow',
    });
  });

  it('returns null when systemAgent.memoryAnalysis is not configured', () => {
    vi.mocked(getQConfig).mockReturnValue({
      serviceModel: {
        defaultAgent: { model: 'claude-sonnet-4-6', provider: 'ada' },
        systemAgent: {
          topic: { model: 'DeepSeek-V4-Flash', provider: 'tripflow' },
        },
      },
    });

    expect(getMemoryAnalysisTaskConfig()).toBeNull();
  });

  it('falls back to ada when service model task is missing', () => {
    vi.mocked(getQConfig).mockReturnValue({
      providers: {},
    });

    expect(getQConfigServiceModelTask('topic')).toEqual({
      credential: 'user',
      model: 'DeepSeek-V4-Flash',
      provider: 'ada',
    });
  });

  it('reads provider access and runtime config', () => {
    vi.mocked(getQConfig).mockReturnValue({
      access: {
        ztrip: {
          whitelist: ['S63237'],
        },
      },
      runtime: {
        ztrip: {
          petaKeyId: 'peta-100000533',
          tags: { lane: 'uat' },
        },
        tripflow: {
          petaKeyId: 'peta-100000533',
          tags: { lane: 'uat' },
        },
      },
    });

    expect(getQConfigProviderAccess('ztrip')).toEqual({
      whitelist: ['S63237'],
    });
    expect(getQConfigProviderRuntime('ztrip')).toEqual({
      petaKeyId: 'peta-100000533',
      tags: { lane: 'uat' },
    });
    expect(getQConfigProviderRuntime('tripflow')).toEqual({
      petaKeyId: 'peta-100000533',
      tags: { lane: 'uat' },
    });
  });
});

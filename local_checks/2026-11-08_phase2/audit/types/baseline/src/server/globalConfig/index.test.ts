import { describe, expect, it, vi } from 'vitest';

import { getAppConfig } from '@/envs/app';
import { type SystemEmbeddingConfig } from '@/types/knowledgeBase';
import { type FilesConfigItem } from '@/types/user/settings/filesConfig';

import { getServerDefaultAgentConfig, getServerDefaultFilesConfig } from './index';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';

vi.mock('@/envs/app', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    DEFAULT_FILES_CONFIG: 'test_config',
  },
}));

vi.mock('./parseDefaultAgent', () => ({
  parseAgentConfig: vi.fn(),
}));

vi.mock('./parseFilesConfig', () => ({
  parseFilesConfig: vi.fn(),
}));

vi.mock('@/server/services/serviceModel/config', () => ({
  buildDefaultAgentFromServiceModel: vi.fn(() => ({
    model: 'DeepSeek-V4-Flash',
    provider: 'ada',
  })),
  buildSystemAgentFromServiceModel: vi.fn(() => ({})),
}));

describe('getServerDefaultAgentConfig', () => {
  it('should merge parsed agent config with qconfig default agent', () => {
    const mockConfig = { model: 'env-model', params: { temperature: 0.7 }, provider: 'tripflow' };
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultAgentConfig();

    expect(parseAgentConfig).toHaveBeenCalledWith('test_agent_config');
    expect(result).toEqual({
      model: 'DeepSeek-V4-Flash',
      params: { temperature: 0.7 },
      provider: 'ada',
    });
  });

  it('should return qconfig default agent if parseAgentConfig returns undefined', () => {
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(undefined);

    const result = getServerDefaultAgentConfig();

    expect(result).toEqual({
      model: 'DeepSeek-V4-Flash',
      provider: 'ada',
    });
  });
});

describe('getServerDefaultFilesConfig', () => {
  it('should return parsed files config', () => {
    const mockEmbeddingModel: FilesConfigItem = {
      model: 'test-model',
      provider: 'test-provider',
    };

    const mockRerankerModel: FilesConfigItem = {
      model: 'test-reranker',
      provider: 'test-provider',
    };

    const mockConfig: SystemEmbeddingConfig = {
      embeddingModel: mockEmbeddingModel,
      queryMode: 'hybrid',
      rerankerModel: mockRerankerModel,
    };

    vi.mocked(parseFilesConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultFilesConfig();

    expect(parseFilesConfig).toHaveBeenCalledWith('test_config');
    expect(result).toEqual(mockConfig);
  });
});

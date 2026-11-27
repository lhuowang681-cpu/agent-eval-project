import {
  getQConfigProviderAccess,
  getQConfigProviderRuntime,
  resolveQConfigProviderModels,
} from '@lobechat/utils/qconfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePetaRuntimeCredential } from '@/server/services/petaGateway/resolveTripflowGateway';

import { getZtripWhitelistRuntimePatch } from './getZtripRuntimeOverrides';

vi.mock('@lobechat/utils/qconfig', () => ({
  getQConfigProviderAccess: vi.fn(),
  getQConfigProviderRuntime: vi.fn(),
  resolveQConfigProviderModels: vi.fn(),
}));

vi.mock('@/server/services/petaGateway/resolveTripflowGateway', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    resolvePetaRuntimeCredential: vi.fn(),
  };
});

const createDb = (username: string | null) =>
  ({
    query: {
      users: {
        findFirst: vi.fn(async () => ({ username })),
      },
    },
  }) as any;

describe('getZtripWhitelistRuntimePatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves ztrip petaKeyId from qconfig when username is whitelisted', async () => {
    vi.mocked(getQConfigProviderAccess).mockReturnValue({ whitelist: ['S63237'] });
    vi.mocked(getQConfigProviderRuntime).mockReturnValue({
      petaKeyId: 'peta-100000533',
      tags: { lane: 'uat' },
    });
    vi.mocked(resolveQConfigProviderModels).mockReturnValue(null);
    vi.mocked(resolvePetaRuntimeCredential).mockResolvedValue({
      apiKey: 'resolved-api-key',
      baseURL: 'https://resolved.example.com/llm/100000533',
      petaKeyId: 'peta-100000533',
    });

    await expect(getZtripWhitelistRuntimePatch(createDb('S63237'), 'user-1')).resolves.toEqual({
      apiKey: 'resolved-api-key',
      baseURL: 'https://resolved.example.com/llm/100000533',
    });

    expect(resolvePetaRuntimeCredential).toHaveBeenCalledWith({
      db: expect.any(Object),
      petaKeyId: 'peta-100000533',
      provider: 'ztrip',
      tags: { lane: 'uat' },
      userId: 'user-1',
    });
  });

  it('returns null when username is not whitelisted', async () => {
    vi.mocked(getQConfigProviderAccess).mockReturnValue({ whitelist: ['S63237'] });
    vi.mocked(getQConfigProviderRuntime).mockReturnValue({
      petaKeyId: 'peta-100000533',
    });
    vi.mocked(resolveQConfigProviderModels).mockReturnValue(null);

    await expect(getZtripWhitelistRuntimePatch(createDb('S00000'), 'user-1')).resolves.toBeNull();
    expect(resolvePetaRuntimeCredential).not.toHaveBeenCalled();
  });
});

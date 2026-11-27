import {
  getQConfigProviderAccess,
  getQConfigProviderRuntime,
  resolveQConfigProviderModels,
} from '@lobechat/utils/qconfig';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLobehubRemoteConfig } from './fetchLobehubAppConfig';

vi.mock('@lobechat/utils/qconfig', () => ({
  getQConfigProviderAccess: vi.fn(),
  getQConfigProviderRuntime: vi.fn(),
  resolveQConfigProviderModels: vi.fn(),
}));

describe('getLobehubRemoteConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads lobehub config from qconfig', async () => {
    vi.mocked(getQConfigProviderAccess).mockReturnValue({
      whitelist: [' S63237 '],
    });
    vi.mocked(getQConfigProviderRuntime).mockReturnValue({
      petaKeyId: ' peta-100000533 ',
      tags: { lane: ' uat ', user: 'ignored' },
    });
    vi.mocked(resolveQConfigProviderModels).mockReturnValue([
      { abilities: {}, displayName: ' Test ', enabled: true, id: 'm1', type: 'chat' },
    ]);

    await expect(getLobehubRemoteConfig()).resolves.toEqual({
      whitelist: ['S63237'],
      ztrip: {
        petaKeyId: 'peta-100000533',
        tags: { lane: 'uat', user: 'ignored' },
        models: [
          {
            abilities: {},
            contextWindowTokens: undefined,
            description: undefined,
            displayName: 'Test',
            enabled: true,
            id: 'm1',
            maxOutput: undefined,
            organization: undefined,
            parameters: undefined,
            pricing: undefined,
            releasedAt: undefined,
            settings: undefined,
            type: 'chat',
          },
        ],
      },
    });
  });

  it('returns null when qconfig is unavailable', async () => {
    vi.mocked(getQConfigProviderAccess).mockReturnValue(undefined);
    vi.mocked(getQConfigProviderRuntime).mockReturnValue(undefined);
    vi.mocked(resolveQConfigProviderModels).mockReturnValue(null);

    await expect(getLobehubRemoteConfig()).resolves.toBeNull();
  });
});

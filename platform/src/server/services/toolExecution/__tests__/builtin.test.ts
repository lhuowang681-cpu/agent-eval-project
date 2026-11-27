import { describe, expect, it, vi } from 'vitest';

import { BuiltinToolsExecutor } from '../builtin';

const mockRuntime = vi.hoisted(() => ({
  addContextMemory: vi.fn().mockResolvedValue({ content: 'ok', success: true }),
}));

const mockHasServerRuntime = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockGetServerRuntime = vi.hoisted(() => vi.fn().mockResolvedValue(mockRuntime));

vi.mock('@lobechat/builtin-tools', () => ({
  builtinTools: [
    {
      identifier: 'lobe-user-memory',
      manifest: {
        api: [
          {
            name: 'addContextMemory',
            parameters: {
              properties: {
                tags: {
                  items: { type: 'string' },
                  type: 'array',
                },
                withContext: {
                  properties: {
                    title: { type: 'string' },
                    type: { type: 'string' },
                  },
                  type: 'object',
                },
              },
              type: 'object',
            },
          },
        ],
      },
    },
  ],
}));

vi.mock('../serverRuntimes', () => ({
  getServerRuntime: mockGetServerRuntime,
  hasServerRuntime: mockHasServerRuntime,
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    executeKlavisTool: vi.fn(),
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    executeLobehubSkill: vi.fn(),
  })),
}));

describe('BuiltinToolsExecutor', () => {
  it('coerces stringified array/object arguments by schema for builtin tools', async () => {
    const executor = new BuiltinToolsExecutor({} as any, 'user-1');

    await executor.execute(
      {
        apiName: 'addContextMemory',
        arguments: JSON.stringify({
          details: '用户告知今年25岁',
          memoryCategory: 'personal',
          memoryType: 'fact',
          summary: '用户今年25岁',
          tags: '["年龄"]',
          title: '用户年龄信息',
          withContext: '{"title":"用户基本信息","type":"user_profile"}',
        }),
        id: 'call-1',
        identifier: 'lobe-user-memory',
        type: 'builtin',
      },
      { toolManifestMap: {}, userId: 'user-1' },
    );

    expect(mockRuntime.addContextMemory).toHaveBeenCalledTimes(1);
    expect(mockRuntime.addContextMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['年龄'],
        withContext: { title: '用户基本信息', type: 'user_profile' },
      }),
      expect.any(Object),
    );
  });
});

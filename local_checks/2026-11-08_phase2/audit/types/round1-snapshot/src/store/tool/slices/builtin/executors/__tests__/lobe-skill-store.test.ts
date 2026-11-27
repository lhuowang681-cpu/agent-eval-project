import { SkillStoreApiName } from '@lobechat/builtin-tool-skill-store';
import { type BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const installSkill = vi.fn();
const getByIdentifier = vi.fn();
const importFromMarket = vi.fn();
const refreshAgentSkills = vi.fn();

vi.mock('@/services/marketApi', () => ({
  communityApiService: {
    installSkill,
  },
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getByIdentifier,
    importFromGitHub: vi.fn(),
    importFromMarket,
    importFromUrl: vi.fn(),
  },
}));

vi.mock('@/services/discover', () => ({
  discoverService: {
    getSkillList: vi.fn(),
  },
}));

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => ({
    refreshAgentSkills,
  }),
}));

const createContext = (): BuiltinToolContext => ({
  messageId: 'message-id',
});

describe('skillStoreExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs market skills through the community market path', async () => {
    getByIdentifier.mockResolvedValue(undefined);
    installSkill.mockResolvedValue({
      id: 'skill-1',
      identifier: 'slides',
      name: 'Slides',
    });

    const { skillStoreExecutor } = await import('../lobe-skill-store');

    const result = await skillStoreExecutor.invoke(
      SkillStoreApiName.importFromMarket,
      { identifier: 'slides' },
      createContext(),
    );

    expect(getByIdentifier).toHaveBeenCalledWith('slides');
    expect(installSkill).toHaveBeenCalledWith('slides');
    expect(importFromMarket).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: {
        name: 'Slides',
        skillId: 'skill-1',
        status: 'created',
        success: true,
      },
      success: true,
    });
  });
});

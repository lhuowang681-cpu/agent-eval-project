import { describe, expect, it, vi } from 'vitest';

import { SkillStoreServerRuntimeService } from '../skillStore';

vi.mock('@/server/services/community', () => ({
  CommunityService: class CommunityService {},
}));

const createService = () => {
  const communityService = {
    getSkillList: vi.fn(),
    installSkill: vi.fn(),
  };
  const importer = {
    importFromGitHub: vi.fn(),
    importFromUrl: vi.fn(),
  };
  const marketService = {
    getSkillDownloadUrl: vi.fn(),
    searchSkill: vi.fn(),
  };
  const skillModel = {
    findByIdentifier: vi.fn(),
  };

  const service = new SkillStoreServerRuntimeService({
    communityService: communityService as any,
    importer: importer as any,
    skillModel: skillModel as any,
  });

  return { communityService, importer, marketService, service, skillModel };
};

describe('SkillStoreServerRuntimeService', () => {
  it('searches skills through the community market with mapped params', async () => {
    const { communityService, marketService, service } = createService();
    communityService.getSkillList.mockResolvedValue({
      data: [
        {
          category: 'productivity',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          description: 'Create documents',
          identifier: 'docx',
          installCount: 12,
          name: 'Docx',
          updatedAt: new Date('2026-02-01T00:00:00Z'),
          version: '1.2.3',
        },
      ],
      total: 1,
    });

    const result = await service.searchSkill({
      category: 'productivity',
      locale: 'zh-CN',
      order: 'asc',
      page: 2,
      pageSize: 10,
      q: 'doc',
      sort: 'stars',
    });

    expect(communityService.getSkillList).toHaveBeenCalledWith({
      category: 'productivity',
      keyword: 'doc',
      page: 2,
      pageSize: 10,
      sortBy: 'recommended',
    });
    expect(marketService.searchSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [
        {
          category: 'productivity',
          createdAt: '2026-01-01T00:00:00.000Z',
          description: 'Create documents',
          identifier: 'docx',
          installCount: 12,
          name: 'Docx',
          updatedAt: '2026-02-01T00:00:00.000Z',
          version: '1.2.3',
        },
      ],
      page: 2,
      pageSize: 10,
      total: 1,
    });
  });

  it('imports market skills through the community market installer', async () => {
    const { communityService, importer, marketService, service, skillModel } = createService();
    skillModel.findByIdentifier.mockResolvedValue(undefined);
    communityService.installSkill.mockResolvedValue({
      id: 'skill-1',
      name: 'Docx',
    });

    const result = await service.importFromMarket('docx');

    expect(communityService.installSkill).toHaveBeenCalledWith('docx');
    expect(marketService.getSkillDownloadUrl).not.toHaveBeenCalled();
    expect(importer.importFromUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      skill: { id: 'skill-1', name: 'Docx' },
      status: 'created',
    });
  });

  it('returns unchanged when the market skill is already installed with a zip package', async () => {
    const { communityService, service, skillModel } = createService();
    skillModel.findByIdentifier.mockResolvedValue({
      id: 'skill-1',
      installedFromMarketIdentifier: 'docx',
      name: 'Docx',
      zipFileHash: 'zip-hash',
    });
    communityService.installSkill.mockResolvedValue({
      id: 'skill-1',
      name: 'Docx',
    });

    const result = await service.importFromMarket('docx');

    expect(communityService.installSkill).toHaveBeenCalledWith('docx');
    expect(result).toEqual({
      skill: { id: 'skill-1', name: 'Docx' },
      status: 'unchanged',
    });
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ShareService } from './share';

vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: vi.fn().mockImplementation(() => ({
    createPreSignedUrl: vi.fn(),
    getFileContent: vi.fn(),
    getFullFileUrl: vi.fn(),
    uploadContent: vi.fn(),
  })),
}));

describe('ShareService createShare', () => {
  const userId = 'share-owner';

  const createService = () => {
    const service = new ShareService({ serverDB: {} as any, userId });
    const agentModel = { getAgentConfigById: vi.fn() };
    const agentSkillModel = { findById: vi.fn(), findByIdentifier: vi.fn() };
    const marketSkillModel = { create: vi.fn(), findByIdentifier: vi.fn() };
    const marketMcpModel = { create: vi.fn(), findByIdentifier: vi.fn() };
    const marketAgentModel = { create: vi.fn() };
    const shareModel = { create: vi.fn() };
    const knowledgeBaseMarketService = { snapshotLocalToMarket: vi.fn() };
    const db = { select: vi.fn() };
    Object.assign(service as any, {
      agentModel,
      agentSkillModel,
      db,
      knowledgeBaseMarketService,
      marketAgentModel,
      marketMcpModel,
      marketSkillModel,
      shareModel,
    });
    return {
      agentModel,
      agentSkillModel,
      db,
      knowledgeBaseMarketService,
      marketAgentModel,
      marketMcpModel,
      marketSkillModel,
      service,
      shareModel,
    };
  };

  it('creates an unlisted market skill snapshot + share row', async () => {
    const { agentSkillModel, marketSkillModel, service, shareModel } = createService();
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'sk-1',
      identifier: 'skl_local',
      name: 'My Skill',
      description: 'desc',
      content: '# c',
      manifest: { name: 'My Skill' },
      resources: { '/a.txt': { size: 1 } },
      editorData: { root: true },
    });
    marketSkillModel.create.mockResolvedValue({ identifier: 'skl_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_skill' });

    const res = await service.createShare({ itemType: 'skill', localId: 'skl_local' });

    expect(marketSkillModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'unlisted',
        identifier: 'skl_local',
        name: 'My Skill',
      }),
    );
    expect(shareModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: userId,
        itemType: 'skill',
        marketIdentifier: 'skl_local',
        name: 'My Skill',
      }),
    );
    expect(res.url).toBe('/share/tok_skill');
  });

  it('creates an unlisted market mcp snapshot with sanitized headers', async () => {
    const { db, marketMcpModel, service, shareModel } = createService();
    const localMcp = {
      identifier: 'mcp_local',
      manifest: { meta: { title: 'My MCP' }, tools: [{ name: 't' }] },
      customParams: {
        type: 'http',
        mcp: {
          type: 'http',
          url: 'https://x',
          headers: { 'x-bbzai-mcp-token': 'secret', 'x-other': 'keep' },
        },
      },
    };
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => [localMcp]),
    };
    db.select.mockReturnValue(chain);
    marketMcpModel.create.mockResolvedValue({ identifier: 'mcp_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_mcp' });

    await service.createShare({ itemType: 'mcp', localId: 'mcp_local' });

    const createArg = marketMcpModel.create.mock.calls[0][0];
    expect(createArg.visibility).toBe('unlisted');
    const headers = createArg.customParams.mcp.headers;
    expect(headers['x-bbzai-mcp-token']).toBe('');
    expect(headers['x-other']).toBe('keep');
  });

  it('creates an unlisted agent with cascaded unlisted skill + mcp snapshots', async () => {
    const {
      agentModel,
      db,
      marketAgentModel,
      marketMcpModel,
      marketSkillModel,
      service,
      shareModel,
    } = createService();

    agentModel.getAgentConfigById.mockResolvedValue({
      id: 'agt-1',
      title: 'My Agent',
      systemRole: 'you are x',
      description: 'd',
      avatar: null,
      backgroundColor: null,
      tags: [],
      model: 'gpt-4o',
      provider: 'openai',
      plugins: ['mcp_local'],
      skills: ['skl_local'],
      chatConfig: {},
      fewShots: null,
      openingMessage: null,
      openingQuestions: [],
      editorData: { root: true },
    });

    // collectAgentSkillIdentifiers looks up agentSkills by identifier
    const skillRow = {
      identifier: 'skl_local',
      name: 'My Skill',
      description: 'd',
      content: '#c',
      manifest: { name: 'My Skill' },
      resources: {},
      editorData: null,
    };
    const mcpRow = {
      identifier: 'mcp_local',
      manifest: { meta: { title: 'My MCP' }, tools: [] },
      customParams: { type: 'http', mcp: { type: 'http', url: 'https://x', headers: {} } },
    };

    const selectChain = (row: any) => ({
      from: vi.fn(() => selectChain(row)),
      innerJoin: vi.fn(() => selectChain(row)),
      where: vi.fn(() => selectChain(row)),
      limit: vi.fn(async () => [row]),
    });
    db.select.mockImplementation(() => selectChain(mcpRow));
    (service as any).agentSkillModel.findByIdentifier = vi.fn((id: string) =>
      id === 'skl_local' ? skillRow : undefined,
    );
    (service as any).marketSkillModel.findByIdentifier = vi.fn().mockResolvedValue(undefined);
    (service as any).marketMcpModel.findByIdentifier = vi.fn().mockResolvedValue(undefined);

    marketAgentModel.create.mockResolvedValue({ identifier: 'agt_x' });
    marketSkillModel.create.mockResolvedValue({ identifier: 'skl_local' });
    marketMcpModel.create.mockResolvedValue({ identifier: 'mcp_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_agent' });

    const res = await service.createShare({ itemType: 'agent', localId: 'agt-1' });

    expect(marketSkillModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'unlisted', identifier: 'skl_local' }),
    );
    // mcp_local is a plugin, not a local skill → must NOT be cascaded as a skill
    expect(marketSkillModel.create.mock.calls).toHaveLength(1);
    expect(marketSkillModel.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'mcp_local' }),
    );
    expect(marketMcpModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'unlisted', identifier: 'mcp_local' }),
    );
    const agentArg = marketAgentModel.create.mock.calls[0][0];
    expect(agentArg.visibility).toBe('unlisted');
    expect(agentArg.skills).toContain('skl_local');
    expect(agentArg.plugins).toContain('mcp_local');
    expect(res.url).toBe('/share/tok_agent');
  });

  it('cascades bundled knowledge base snapshots and writes their ids to marketAgent.knowledgeBases', async () => {
    const { agentModel, knowledgeBaseMarketService, marketAgentModel, service, shareModel } =
      createService();

    agentModel.getAgentConfigById.mockResolvedValue({
      id: 'agt-kb',
      title: 'A',
      systemRole: 'sr',
      description: 'd',
      avatar: null,
      backgroundColor: null,
      tags: [],
      model: 'gpt-4o',
      provider: 'openai',
      plugins: [],
      skills: [],
      knowledgeBases: [{ id: 'kb-1' }, { id: 'kb-2' }],
      chatConfig: {},
      fewShots: null,
      openingMessage: null,
      openingQuestions: [],
      editorData: null,
    });
    knowledgeBaseMarketService.snapshotLocalToMarket.mockResolvedValue({ id: 'mk' });
    marketAgentModel.create.mockResolvedValue({ identifier: 'agt_kb' });
    shareModel.create.mockResolvedValue({ token: 'tok_kb' });

    await service.createShare({ itemType: 'agent', localId: 'agt-kb' });

    expect(knowledgeBaseMarketService.snapshotLocalToMarket).toHaveBeenCalledTimes(2);
    expect(knowledgeBaseMarketService.snapshotLocalToMarket).toHaveBeenCalledWith(
      'kb-1',
      'bundled',
    );
    expect(knowledgeBaseMarketService.snapshotLocalToMarket).toHaveBeenCalledWith(
      'kb-2',
      'bundled',
    );
    const agentArg = marketAgentModel.create.mock.calls[0][0];
    expect(agentArg.knowledgeBases).toEqual(['kb-1', 'kb-2']);
    expect(agentArg.knowledgeCount).toBe(2);
  });

  it('skips marketSkill.create when a market skill with the same identifier already exists', async () => {
    const { agentModel, marketAgentModel, marketMcpModel, marketSkillModel, service, shareModel } =
      createService();

    agentModel.getAgentConfigById.mockResolvedValue({
      id: 'agt-2',
      title: 'My Agent',
      systemRole: 'you are x',
      description: 'd',
      avatar: null,
      backgroundColor: null,
      tags: [],
      model: 'gpt-4o',
      provider: 'openai',
      plugins: [],
      skills: ['skl_existing'],
      chatConfig: {},
      fewShots: null,
      openingMessage: null,
      openingQuestions: [],
      editorData: null,
    });

    const skillRow = {
      identifier: 'skl_existing',
      name: 'Existing Skill',
      description: 'd',
      content: '#c',
      manifest: { name: 'Existing Skill' },
      resources: {},
      editorData: null,
    };

    (service as any).agentSkillModel.findByIdentifier = vi.fn((id: string) =>
      id === 'skl_existing' ? skillRow : undefined,
    );
    // market already has this identifier → should skip create
    (service as any).marketSkillModel.findByIdentifier = vi
      .fn()
      .mockResolvedValue({ identifier: 'skl_existing' });
    (service as any).marketMcpModel.findByIdentifier = vi.fn().mockResolvedValue(undefined);

    marketAgentModel.create.mockResolvedValue({ identifier: 'agt_y' });
    shareModel.create.mockResolvedValue({ token: 'tok_skip' });

    await service.createShare({ itemType: 'agent', localId: 'agt-2' });

    expect(marketSkillModel.create).not.toHaveBeenCalled();
    expect(marketMcpModel.create).not.toHaveBeenCalled();
  });

  it('reuses an existing market skill record on re-share (no second marketSkill.create, new token)', async () => {
    const { agentSkillModel, marketSkillModel, service, shareModel } = createService();
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'sk-1',
      identifier: 'skl_local',
      name: 'My Skill',
      description: 'desc',
      content: '# c',
      manifest: { name: 'My Skill' },
      resources: { '/a.txt': { size: 1 } },
      editorData: { root: true },
    });
    // market already has a record for this identifier (e.g. a prior share)
    marketSkillModel.findByIdentifier.mockResolvedValue({ identifier: 'skl_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_skill_2' });

    const res = await service.createShare({ itemType: 'skill', localId: 'skl_local' });

    // Must NOT attempt a second insert — that would trip the unique index.
    expect(marketSkillModel.create).not.toHaveBeenCalled();
    // A new share row (new token) is still created against the same record.
    expect(shareModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        marketIdentifier: 'skl_local',
        itemType: 'skill',
        name: 'My Skill',
      }),
    );
    expect(res.token).toBe('tok_skill_2');
    expect(res.url).toBe('/share/tok_skill_2');
  });

  it('reuses an existing market mcp record on re-share (no second marketMcp.create, new token)', async () => {
    const { db, marketMcpModel, service, shareModel } = createService();
    const localMcp = {
      identifier: 'mcp_local',
      manifest: { meta: { title: 'My MCP' }, tools: [{ name: 't' }] },
      customParams: { type: 'http', mcp: { type: 'http', url: 'https://x', headers: {} } },
    };
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => [localMcp]),
    };
    db.select.mockReturnValue(chain);
    // market already has a record for this identifier
    marketMcpModel.findByIdentifier.mockResolvedValue({ identifier: 'mcp_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_mcp_2' });

    const res = await service.createShare({ itemType: 'mcp', localId: 'mcp_local' });

    expect(marketMcpModel.create).not.toHaveBeenCalled();
    expect(shareModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        marketIdentifier: 'mcp_local',
        itemType: 'mcp',
        name: 'My MCP',
      }),
    );
    expect(res.token).toBe('tok_mcp_2');
    expect(res.url).toBe('/share/tok_mcp_2');
  });
});

describe('ShareService getByToken/revoke', () => {
  const userId = 'share-owner';
  const createService = () => {
    const service = new ShareService({ serverDB: {} as any, userId });
    const shareModel = {
      create: vi.fn(),
      findByToken: vi.fn(),
      findMyList: vi.fn(),
      setRevoked: vi.fn().mockResolvedValue(undefined),
      countActiveByMarketIdentifier: vi.fn().mockResolvedValue(0),
      incrementInstallCount: vi.fn().mockResolvedValue(undefined),
      incrementViewCount: vi.fn().mockResolvedValue(undefined),
    };
    const marketAgentModel = { deleteUnlistedByIdentifier: vi.fn().mockResolvedValue(undefined) };
    const marketSkillModel = { deleteUnlistedByIdentifier: vi.fn().mockResolvedValue(undefined) };
    const marketMcpModel = { deleteUnlistedByIdentifier: vi.fn().mockResolvedValue(undefined) };
    Object.assign(service as any, {
      marketAgentModel,
      marketMcpModel,
      marketSkillModel,
      shareModel,
    });
    return { marketAgentModel, marketMcpModel, marketSkillModel, service, shareModel };
  };

  it('returns share info for a valid token', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'S',
      revokedAt: null,
      expiresAt: null,
    });
    const res = await service.getByToken('tok');
    expect(res).toEqual({ itemType: 'skill', marketIdentifier: 'skl_x', name: 'S' });
    expect(shareModel.incrementViewCount).toHaveBeenCalledWith('tok');
  });

  it('throws 410 when revoked', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      revokedAt: new Date(),
      expiresAt: null,
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'S',
    });
    await expect(service.getByToken('tok')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('throws 410 when expired', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'S',
    });
    await expect(service.getByToken('tok')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(shareModel.incrementViewCount).not.toHaveBeenCalled();
  });

  it('throws 404 when not found', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue(undefined);
    await expect(service.getByToken('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revoke rejects non-owner', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: 'someone-else',
      revokedAt: null,
    });
    await expect(service.revoke('tok')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(shareModel.setRevoked).not.toHaveBeenCalled();
  });

  it('revoke reclaims the unlisted market record when no active share remains', async () => {
    const { service, shareModel, marketAgentModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      itemType: 'agent',
      marketIdentifier: 'agt_x',
      revokedAt: null,
    });
    shareModel.countActiveByMarketIdentifier.mockResolvedValue(0);

    await service.revoke('tok');

    expect(shareModel.setRevoked).toHaveBeenCalledWith('tok');
    expect(shareModel.countActiveByMarketIdentifier).toHaveBeenCalledWith('agent', 'agt_x');
    expect(marketAgentModel.deleteUnlistedByIdentifier).toHaveBeenCalledWith('agt_x');
  });

  it('revoke keeps the market record when another active share still references it', async () => {
    const { service, shareModel, marketSkillModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      itemType: 'skill',
      marketIdentifier: 'user.abc',
      revokedAt: null,
    });
    shareModel.countActiveByMarketIdentifier.mockResolvedValue(1);

    await service.revoke('tok');

    expect(shareModel.setRevoked).toHaveBeenCalledWith('tok');
    expect(marketSkillModel.deleteUnlistedByIdentifier).not.toHaveBeenCalled();
  });

  it('revoke routes reclaim to the mcp model for mcp shares', async () => {
    const { service, shareModel, marketMcpModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      itemType: 'mcp',
      marketIdentifier: 'mcp_x',
      revokedAt: null,
    });
    shareModel.countActiveByMarketIdentifier.mockResolvedValue(0);

    await service.revoke('tok');

    expect(marketMcpModel.deleteUnlistedByIdentifier).toHaveBeenCalledWith('mcp_x');
  });
});

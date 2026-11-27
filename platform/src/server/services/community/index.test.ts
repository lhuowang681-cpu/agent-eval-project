// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { CommunityService } from './index';

vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: vi.fn().mockImplementation(() => ({
    createPreSignedUrl: vi.fn(),
    createPreSignedUrlForPreview: vi.fn(),
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
    getFileByteArray: vi.fn(),
    getFileContent: vi.fn(),
    getFileMetadata: vi.fn(),
    getFullFileUrl: vi.fn(),
    getKeyFromFullUrl: vi.fn(),
    uploadBuffer: vi.fn(),
    uploadContent: vi.fn(),
    uploadMedia: vi.fn(),
  })),
}));

describe('CommunityService restore market resources', () => {
  const userId = 'community-restore-user';
  const otherUserId = 'community-restore-other-user';

  const createService = () => {
    const service = new CommunityService({ serverDB: {} as any, userId });
    const marketAgentModel = {
      create: vi.fn(),
      findByDisplayName: vi.fn(),
      findByIdentifier: vi.fn(),
      getDetail: vi.fn(),
      incrementInstallCount: vi.fn(),
    };
    const marketSkillModel = {
      create: vi.fn(),
      findByIdentifier: vi.fn(),
      incrementInstallCount: vi.fn(),
    };
    const agentModel = {
      create: vi.fn(),
      createAgentKnowledgeBase: vi.fn(),
      getAgentConfigById: vi.fn(),
      update: vi.fn(),
    };
    const agentSkillModel = {
      create: vi.fn(),
      findByIdentifier: vi.fn(),
      update: vi.fn(),
    };
    const marketMcpModel = {
      findByIdentifier: vi.fn(),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn(),
      update: vi.fn(),
    };
    const skillParser = {
      buildSkillZipPackage: vi.fn(),
    };
    const fileService = {
      createGlobalFile: vi.fn(),
      uploadBuffer: vi.fn(),
    };
    const skillResourceService = {
      readResource: vi.fn(),
    };
    const skillSecurityScanner = {
      assertZipSafe: vi.fn(),
    };
    const marketAvatarService = {
      generateAvatar: vi.fn().mockResolvedValue('generated-avatar'),
    };

    Object.assign(service as any, {
      agentModel,
      agentSkillModel,
      db,
      fileService,
      marketAgentModel,
      marketAvatarService,
      marketMcpModel,
      marketSkillModel,
      skillParser,
      skillResourceService,
      skillSecurityScanner,
    });

    return {
      agentModel,
      agentSkillModel,
      db,
      fileService,
      marketAgentModel,
      marketAvatarService,
      marketMcpModel,
      marketSkillModel,
      service,
      skillParser,
      skillResourceService,
      skillSecurityScanner,
    };
  };

  it('restores a published skill to local and keeps it linked to the market item', async () => {
    const { agentSkillModel, marketSkillModel, service } = createService();
    const marketSkill = {
      identifier: 'skl_restore',
      name: 'Restored Skill',
      description: 'Restore me',
      content: '# Restored',
      manifest: { name: 'Restored Skill', version: '1.2.3' },
      resources: { '/file.txt': { size: 10 } },
      editorData: { root: true },
      publisherId: userId,
      version: '1.2.3',
    };
    marketSkillModel.findByIdentifier.mockResolvedValue(marketSkill);
    agentSkillModel.findByIdentifier.mockResolvedValue(undefined);
    agentSkillModel.create.mockImplementation(async (input) => ({
      id: 'local-skill-id',
      ...input,
    }));

    const restored = await service.restoreSkillToLocal('skl_restore');

    expect(agentSkillModel.create).toHaveBeenCalledWith({
      identifier: 'skl_restore',
      name: 'Restored Skill',
      description: 'Restore me',
      content: '# Restored',
      editorData: { root: true },
      installedFromMarketIdentifier: null,
      installedFromSnapshot: null,
      installedMarketVersion: '1.2.3',
      manifest: { name: 'Restored Skill', version: '1.2.3' },
      marketIdentifier: 'skl_restore',
      resources: { '/file.txt': { size: 10 } },
      source: 'user',
    });
    expect(restored).toMatchObject({
      identifier: 'skl_restore',
      marketIdentifier: 'skl_restore',
    });
  });

  it('rejects restoring a skill owned by another publisher', async () => {
    const { marketSkillModel, service } = createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'skl_other',
      publisherId: otherUserId,
    });

    await expect(service.restoreSkillToLocal('skl_other')).rejects.toThrow('FORBIDDEN');
  });

  it('rejects restoring a skill when a different local skill already uses the identifier', async () => {
    const { agentSkillModel, marketSkillModel, service } = createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'skl_conflict',
      name: 'Market Skill',
      description: 'Market',
      manifest: { name: 'Market Skill' },
      publisherId: userId,
    });
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'local-skill-id',
      identifier: 'skl_conflict',
      marketIdentifier: null,
    });

    await expect(service.restoreSkillToLocal('skl_conflict')).rejects.toThrow(
      'LOCAL_IDENTIFIER_CONFLICT',
    );
  });

  it('promotes an installed market skill owned by the publisher into the local market-linked copy', async () => {
    const { agentSkillModel, marketSkillModel, service } = createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'skl_promote',
      name: 'Promoted Skill',
      description: 'Promote',
      manifest: { name: 'Promoted Skill' },
      publisherId: userId,
      version: '1.0.2',
    });
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'installed-skill-id',
      identifier: 'skl_promote',
      installedFromMarketIdentifier: 'skl_promote',
      marketIdentifier: null,
    });
    agentSkillModel.update.mockImplementation(async (id, input) => ({ id, ...input }));

    const restored = await service.restoreSkillToLocal('skl_promote');

    expect(agentSkillModel.update).toHaveBeenCalledWith('installed-skill-id', {
      name: 'Promoted Skill',
      description: 'Promote',
      content: undefined,
      editorData: undefined,
      installedFromMarketIdentifier: null,
      installedFromSnapshot: null,
      installedMarketVersion: '1.0.2',
      manifest: { name: 'Promoted Skill' },
      marketIdentifier: 'skl_promote',
      resources: undefined,
      source: 'user',
    });
    expect(restored).toMatchObject({ marketIdentifier: 'skl_promote' });
  });

  it('installs market skill with zipFileHash for desktop runtime', async () => {
    const { agentSkillModel, fileService, marketSkillModel, service, skillParser } =
      createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {
        'references/setup.md': {
          content: 'Install playwright-cli before use.',
          encoding: 'utf8',
        },
      },
      version: '1.0.0',
      visibility: 'public',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('skill-zip'),
      hash: 'zip-hash-1',
    });
    agentSkillModel.findByIdentifier.mockResolvedValue(undefined);
    agentSkillModel.create.mockImplementation(async (input) => ({
      id: 'installed-skill-id',
      ...input,
    }));

    const installed = await service.installSkill('playwright-skill');

    expect(installed.zipFileHash).toBe('zip-hash-1');
    expect(installed.installedFromMarketIdentifier).toBe('playwright-skill');
    expect(installed.installedMarketVersion).toBe('1.0.0');
    expect(installed.resources).toMatchObject({
      'references/setup.md': expect.anything(),
    });
    expect(agentSkillModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        installedFromMarketIdentifier: 'playwright-skill',
        installedMarketVersion: '1.0.0',
        source: 'market',
        zipFileHash: 'zip-hash-1',
      }),
    );
    expect(fileService.uploadBuffer).toHaveBeenCalledWith(
      'skills/zip/zip-hash-1.zip',
      Buffer.from('skill-zip'),
      'application/zip',
    );
    expect(fileService.createGlobalFile).toHaveBeenCalledWith({
      fileHash: 'zip-hash-1',
      fileType: 'application/zip',
      metadata: {
        dirname: 'skills/zip',
        filename: 'zip-hash-1.zip',
        path: 'skills/zip/zip-hash-1.zip',
      },
      size: Buffer.byteLength('skill-zip'),
      url: 'skills/zip/zip-hash-1.zip',
    });

    const buildInput = skillParser.buildSkillZipPackage.mock.calls[0][0];
    const resources = buildInput.resources as Map<string, Buffer>;
    expect(resources.get('references/setup.md')?.toString('utf8')).toBe(
      'Install playwright-cli before use.',
    );
  });

  it('backfills zipFileHash when reinstalling an existing skill without zip', async () => {
    const { agentSkillModel, fileService, marketSkillModel, service, skillParser } =
      createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {},
      version: '1.0.0',
      visibility: 'public',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('skill-zip'),
      hash: 'zip-hash-backfill',
    });
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'legacy-skill-id',
      identifier: 'playwright-skill',
      zipFileHash: null,
      installedFromMarketIdentifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {},
      source: 'market',
    });
    agentSkillModel.update.mockImplementation(async (_id, input) => ({
      id: 'legacy-skill-id',
      identifier: 'playwright-skill',
      ...input,
    }));

    const installed = await service.installSkill('playwright-skill');

    expect(installed.zipFileHash).toBe('zip-hash-backfill');
    expect(agentSkillModel.create).not.toHaveBeenCalled();
    expect(agentSkillModel.update).toHaveBeenCalledWith(
      'legacy-skill-id',
      expect.objectContaining({ zipFileHash: 'zip-hash-backfill' }),
    );
    expect(fileService.uploadBuffer).toHaveBeenCalledWith(
      'skills/zip/zip-hash-backfill.zip',
      Buffer.from('skill-zip'),
      'application/zip',
    );
  });

  it('rejects installing a market skill when a local-only skill uses the same identifier', async () => {
    const { agentSkillModel, marketSkillModel, service, skillParser } = createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {},
      version: '1.0.0',
      visibility: 'public',
    });
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'local-skill-id',
      identifier: 'playwright-skill',
      zipFileHash: null,
      installedFromMarketIdentifier: null,
      marketIdentifier: null,
      source: 'user',
    });

    await expect(service.installSkill('playwright-skill')).rejects.toThrow(
      'LOCAL_IDENTIFIER_CONFLICT',
    );
    expect(agentSkillModel.update).not.toHaveBeenCalled();
    expect(skillParser.buildSkillZipPackage).not.toHaveBeenCalled();
  });

  it('updates installed market skill and refreshes zipFileHash', async () => {
    const { agentSkillModel, db, fileService, marketSkillModel, service, skillParser } =
      createService();
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Updated browser automation',
      manifest: { name: 'Playwright Skill', description: 'Updated browser automation' },
      content: '# Playwright Skill\n\nUpdated content.',
      resources: {
        'references/setup.md': {
          content: 'Updated setup guide.',
          encoding: 'utf8',
        },
      },
      version: '1.1.0',
      visibility: 'public',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('updated-skill-zip'),
      hash: 'zip-hash-2',
    });
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([{ id: 'installed-skill-id' }]),
        }),
      }),
    });

    const result = await service.updateInstalledSkill('playwright-skill');

    expect(result).toEqual({ success: true });
    expect(agentSkillModel.update).toHaveBeenCalledWith(
      'installed-skill-id',
      expect.objectContaining({
        installedMarketVersion: '1.1.0',
        zipFileHash: 'zip-hash-2',
      }),
    );
    expect(fileService.uploadBuffer).toHaveBeenCalledWith(
      'skills/zip/zip-hash-2.zip',
      Buffer.from('updated-skill-zip'),
      'application/zip',
    );
  });

  it('installs market agent with bundled skill and writes zipFileHash', async () => {
    const {
      agentModel,
      agentSkillModel,
      db,
      marketAgentModel,
      marketSkillModel,
      service,
      skillParser,
    } = createService();
    marketAgentModel.getDetail.mockResolvedValue({
      identifier: 'browser-agent',
      title: 'Browser Agent',
      description: 'Uses browser automation',
      skills: ['playwright-skill'],
      plugins: [],
      knowledgeBases: [],
      version: '1.0.0',
    });
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {
        'references/setup.md': {
          content: 'Install playwright-cli before use.',
          encoding: 'utf8',
        },
      },
      version: '1.0.0',
      visibility: 'bundled',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('bundled-skill-zip'),
      hash: 'agent-install-zip-hash',
    });
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    agentModel.create.mockResolvedValue({ id: 'local-agent-id' });
    agentSkillModel.findByIdentifier.mockResolvedValue(undefined);

    await service.installAgent('browser-agent');

    expect(agentSkillModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'playwright-skill',
        installedFromMarketIdentifier: 'playwright-skill',
        installedMarketVersion: '1.0.0',
        source: 'bundled',
        zipFileHash: 'agent-install-zip-hash',
      }),
    );
  });

  it('backfills zipFileHash for an existing bundled skill when installing a market agent', async () => {
    const {
      agentModel,
      agentSkillModel,
      db,
      marketAgentModel,
      marketSkillModel,
      service,
      skillParser,
    } = createService();
    marketAgentModel.getDetail.mockResolvedValue({
      identifier: 'browser-agent',
      title: 'Browser Agent',
      description: 'Uses browser automation',
      skills: ['playwright-skill'],
      plugins: [],
      knowledgeBases: [],
      version: '1.0.0',
    });
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Browser automation',
      manifest: { name: 'Playwright Skill', description: 'Browser automation' },
      content: '# Playwright Skill\n\nUse playwright-cli.',
      resources: {},
      version: '1.0.0',
      visibility: 'bundled',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('bundled-skill-zip'),
      hash: 'agent-install-zip-hash',
    });
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    agentModel.create.mockResolvedValue({ id: 'local-agent-id' });
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'legacy-skill-id',
      identifier: 'playwright-skill',
      installedFromMarketIdentifier: 'playwright-skill',
      zipFileHash: null,
    });

    await service.installAgent('browser-agent');

    expect(agentSkillModel.update).toHaveBeenCalledWith(
      'legacy-skill-id',
      expect.objectContaining({
        installedMarketVersion: '1.0.0',
        zipFileHash: 'agent-install-zip-hash',
      }),
    );
    expect(agentSkillModel.create).not.toHaveBeenCalled();
  });

  it('updates installed market agent bundled skill and refreshes zipFileHash', async () => {
    const {
      agentModel,
      agentSkillModel,
      db,
      marketAgentModel,
      marketSkillModel,
      service,
      skillParser,
    } = createService();
    marketAgentModel.getDetail.mockResolvedValue({
      identifier: 'browser-agent',
      title: 'Browser Agent',
      description: 'Updated browser automation',
      skills: ['playwright-skill'],
      plugins: [],
      knowledgeBases: [],
      version: '1.1.0',
    });
    marketSkillModel.findByIdentifier.mockResolvedValue({
      identifier: 'playwright-skill',
      name: 'Playwright Skill',
      description: 'Updated browser automation',
      manifest: { name: 'Playwright Skill', description: 'Updated browser automation' },
      content: '# Playwright Skill\n\nUpdated content.',
      resources: {
        'references/setup.md': {
          content: 'Updated setup guide.',
          encoding: 'utf8',
        },
      },
      version: '1.1.0',
      visibility: 'bundled',
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({
      buffer: Buffer.from('updated-bundled-skill-zip'),
      hash: 'agent-update-zip-hash',
    });
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([{ id: 'local-agent-id' }]),
        }),
      }),
    });
    agentSkillModel.findByIdentifier.mockResolvedValue({ id: 'installed-skill-id' });

    await service.updateInstalledAgent('browser-agent');

    expect(agentModel.update).toHaveBeenCalledWith(
      'local-agent-id',
      expect.objectContaining({
        installedMarketVersion: '1.1.0',
      }),
    );
    expect(agentSkillModel.update).toHaveBeenCalledWith(
      'installed-skill-id',
      expect.objectContaining({
        installedMarketVersion: '1.1.0',
        zipFileHash: 'agent-update-zip-hash',
      }),
    );
  });

  it('restores a published MCP to local and keeps it linked to the market item', async () => {
    const { db, marketMcpModel, service } = createService();
    marketMcpModel.findByIdentifier.mockResolvedValue({
      identifier: 'mcp_restore',
      manifest: { meta: { title: 'Restored MCP' } },
      customParams: { mcp: { url: 'https://example.com/mcp' } },
      publisherId: userId,
      version: '2.0.1',
    });

    const returning = vi.fn().mockResolvedValue([
      {
        identifier: 'mcp_restore',
        marketIdentifier: 'mcp_restore',
        source: 'user',
      },
    ]);
    const values = vi.fn(() => ({ returning }));
    db.insert.mockReturnValue({ values });
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const restored = await service.restoreMcpToLocal('mcp_restore');

    expect(values).toHaveBeenCalledWith({
      userId,
      identifier: 'mcp_restore',
      type: 'plugin',
      customParams: { mcp: { url: 'https://example.com/mcp' } },
      installedFromMarketIdentifier: null,
      installedFromSnapshot: null,
      installedMarketVersion: '2.0.1',
      manifest: { meta: { title: 'Restored MCP' } },
      marketIdentifier: 'mcp_restore',
      source: 'user',
    });
    expect(restored).toMatchObject({ marketIdentifier: 'mcp_restore' });
  });

  it('promotes an installed market MCP owned by the publisher into the local market-linked copy', async () => {
    const { db, marketMcpModel, service } = createService();
    marketMcpModel.findByIdentifier.mockResolvedValue({
      identifier: 'mcp_promote',
      manifest: { meta: { title: 'Promoted MCP' } },
      customParams: { mcp: { url: 'https://example.com/mcp' } },
      publisherId: userId,
      version: '1.0.2',
    });

    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              identifier: 'mcp_promote',
              installedFromMarketIdentifier: 'mcp_promote',
              marketIdentifier: null,
              source: 'market',
            },
          ]),
        }),
      }),
    });

    const returning = vi.fn().mockResolvedValue([
      {
        identifier: 'mcp_promote',
        installedFromMarketIdentifier: null,
        marketIdentifier: 'mcp_promote',
        source: 'user',
      },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    db.update.mockReturnValue({ set });

    const restored = await service.restoreMcpToLocal('mcp_promote');

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        installedFromMarketIdentifier: null,
        installedFromSnapshot: null,
        installedMarketVersion: '1.0.2',
        marketIdentifier: 'mcp_promote',
        source: 'user',
      }),
    );
    expect(restored).toMatchObject({ marketIdentifier: 'mcp_promote' });
  });

  it('scans unpublished agent skills with concurrency 5 before publishing the agent', async () => {
    const {
      agentModel,
      agentSkillModel,
      marketAgentModel,
      marketSkillModel,
      service,
      skillParser,
      skillSecurityScanner,
    } = createService();
    const skillIdentifiers = Array.from({ length: 7 }, (_, index) => `local-skill-${index + 1}`);
    const localSkills = skillIdentifiers.map((identifier, index) => ({
      id: `skill-id-${index + 1}`,
      identifier,
      name: `Local Skill ${index + 1}`,
      content: `# Local Skill ${index + 1}`,
      manifest: { name: `Local Skill ${index + 1}` },
      resources: {},
      webSafeScanPassed: false,
    }));
    let activeScans = 0;
    let maxActiveScans = 0;

    agentModel.getAgentConfigById.mockResolvedValue({
      id: 'agent-id',
      title: 'Agent',
      systemRole: 'You are helpful',
      skills: skillIdentifiers,
      plugins: [],
    });
    marketAgentModel.findByIdentifier.mockResolvedValue(undefined);
    marketAgentModel.findByDisplayName.mockResolvedValue(undefined);
    marketAgentModel.create.mockResolvedValue({ identifier: 'agt_created' });
    marketSkillModel.findByIdentifier.mockResolvedValue(undefined);
    marketSkillModel.create.mockImplementation(async (input) => input);
    agentSkillModel.findByIdentifier.mockImplementation(async (identifier) =>
      localSkills.find((skill) => skill.identifier === identifier),
    );
    skillParser.buildSkillZipPackage.mockResolvedValue({ buffer: Buffer.from('skill-zip') });
    skillSecurityScanner.assertZipSafe.mockImplementation(async () => {
      activeScans += 1;
      maxActiveScans = Math.max(maxActiveScans, activeScans);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeScans -= 1;
    });
    (service as any).syncAgentKnowledgeBasesToMarket = vi.fn().mockResolvedValue([]);

    await service.publishAgent('agent-id', [], [], [], undefined, 'coding');

    expect(skillSecurityScanner.assertZipSafe).toHaveBeenCalledTimes(7);
    expect(maxActiveScans).toBe(5);
    expect(marketAgentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: expect.stringMatching(/^agt_/),
        skills: skillIdentifiers,
        title: 'Agent',
      }),
    );
    expect(marketSkillModel.create).toHaveBeenCalledTimes(7);
  });

  it('does not publish the agent when an unpublished agent skill fails security scan', async () => {
    const {
      agentModel,
      agentSkillModel,
      marketAgentModel,
      marketSkillModel,
      service,
      skillParser,
      skillSecurityScanner,
    } = createService();
    const scanError = new Error('Skill 安全扫描未通过：风险等级 high。');
    const syncAgentKnowledgeBasesToMarket = vi.fn().mockResolvedValue([]);

    agentModel.getAgentConfigById.mockResolvedValue({
      id: 'agent-id',
      title: 'Agent',
      systemRole: 'You are helpful',
      skills: ['unsafe-skill'],
      plugins: [],
    });
    marketAgentModel.findByIdentifier.mockResolvedValue(undefined);
    marketAgentModel.findByDisplayName.mockResolvedValue(undefined);
    marketSkillModel.findByIdentifier.mockResolvedValue(undefined);
    agentSkillModel.findByIdentifier.mockResolvedValue({
      id: 'unsafe-skill-id',
      identifier: 'unsafe-skill',
      name: 'Unsafe Skill',
      content: '# Unsafe Skill',
      manifest: { name: 'Unsafe Skill' },
      resources: {},
      webSafeScanPassed: false,
    });
    skillParser.buildSkillZipPackage.mockResolvedValue({ buffer: Buffer.from('skill-zip') });
    skillSecurityScanner.assertZipSafe.mockRejectedValue(scanError);
    (service as any).syncAgentKnowledgeBasesToMarket = syncAgentKnowledgeBasesToMarket;

    await expect(service.publishAgent('agent-id', [], [], [], undefined, 'coding')).rejects.toThrow(
      scanError,
    );

    expect(syncAgentKnowledgeBasesToMarket).not.toHaveBeenCalled();
    expect(marketAgentModel.create).not.toHaveBeenCalled();
    expect(marketSkillModel.create).not.toHaveBeenCalled();
  });

  it('re-publishing a self-owned public MCP with an unlinked local plugin routes to update (no duplicate row)', async () => {
    const { db, marketMcpModel, service } = createService();
    // Local plugin exists, but its marketIdentifier link was never backfilled.
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([{ identifier: 'mcp_legacy', marketIdentifier: null }]),
        }),
      }),
    });
    // A market record already lives at the plugin's own identifier, owned by us.
    marketMcpModel.findByIdentifier.mockResolvedValue({
      identifier: 'mcp_legacy',
      publisherId: userId,
      visibility: 'public',
      deletedAt: null,
    });
    (marketMcpModel as any).create = vi.fn();
    (marketMcpModel as any).makePublic = vi.fn();
    (marketMcpModel as any).updateByIdentifier = vi.fn();
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    db.update.mockReturnValue({ set });
    const updateSpy = vi
      .spyOn(service as any, '_updateMcp')
      .mockResolvedValue({ identifier: 'mcp_legacy' });

    await service.publishMcp(
      'mcp_legacy',
      { meta: { title: 'Legacy MCP' } },
      {},
      undefined,
      'other',
    );

    expect((marketMcpModel as any).create).not.toHaveBeenCalled();
    expect((marketMcpModel as any).makePublic).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('mcp_legacy', expect.any(Object), {});
    // link backfilled
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ marketIdentifier: 'mcp_legacy' }));
  });

  it('publishing a share-created unlisted MCP promotes it to public instead of creating a duplicate', async () => {
    const { db, marketMcpModel, service } = createService();
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([{ identifier: 'shared-mcp', marketIdentifier: null }]),
        }),
      }),
    });
    marketMcpModel.findByIdentifier.mockResolvedValue({
      identifier: 'shared-mcp',
      publisherId: userId,
      visibility: 'unlisted',
      deletedAt: null,
      name: 'Shared MCP',
    });
    (marketMcpModel as any).create = vi.fn();
    (marketMcpModel as any).makePublic = vi.fn().mockResolvedValue(undefined);
    (marketMcpModel as any).updateByIdentifier = vi.fn().mockResolvedValue(undefined);
    (marketMcpModel as any).findByDisplayName = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    db.update.mockReturnValue({ set });
    const updateSpy = vi
      .spyOn(service as any, '_updateMcp')
      .mockResolvedValue({ identifier: 'shared-mcp' });

    await service.publishMcp(
      'shared-mcp',
      { meta: { title: 'Shared MCP' } },
      {},
      undefined,
      'other',
    );

    expect((marketMcpModel as any).makePublic).toHaveBeenCalledWith('shared-mcp');
    expect((marketMcpModel as any).updateByIdentifier).toHaveBeenCalledWith('shared-mcp', {
      category: 'other',
    });
    expect((marketMcpModel as any).create).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('shared-mcp', expect.any(Object), {});
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerMarketCommand } from './index';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    market: {
      agent: {
        checkPublishNameConflict: { query: vi.fn() },
        delistAgent: { mutate: vi.fn() },
        getMyAssistantList: { query: vi.fn() },
        installAgent: { mutate: vi.fn() },
        publishAgent: { mutate: vi.fn() },
        relistAgent: { mutate: vi.fn() },
        updateAgent: { mutate: vi.fn() },
        updateInstalledAgent: { mutate: vi.fn() },
      },
      getAssistantDetail: { query: vi.fn() },
      getAssistantList: { query: vi.fn() },
      getKnowledgeBaseDetail: { query: vi.fn() },
      getKnowledgeBaseList: { query: vi.fn() },
      getLeaderboard: { query: vi.fn() },
      getMcpDetail: { query: vi.fn() },
      getMcpList: { query: vi.fn() },
      getPublisherResourceStates: { query: vi.fn() },
      getSkillDetail: { query: vi.fn() },
      getSkillList: { query: vi.fn() },
      getUnpublishedResources: { query: vi.fn() },
      knowledgeBase: {
        checkPublishNameConflict: { query: vi.fn() },
        delistKnowledgeBase: { mutate: vi.fn() },
        getMyKnowledgeBaseList: { query: vi.fn() },
        installKnowledgeBase: { mutate: vi.fn() },
        publishKnowledgeBase: { mutate: vi.fn() },
        relistKnowledgeBase: { mutate: vi.fn() },
        updateInstalledKnowledgeBase: { mutate: vi.fn() },
        updateKnowledgeBase: { mutate: vi.fn() },
      },
      mcp: {
        checkPublishNameConflict: { query: vi.fn() },
        delistMcp: { mutate: vi.fn() },
        getMyMcpList: { query: vi.fn() },
        installMcp: { mutate: vi.fn() },
        publishMcp: { mutate: vi.fn() },
        relistMcp: { mutate: vi.fn() },
        restoreMcpToLocal: { mutate: vi.fn() },
        updateInstalledMcp: { mutate: vi.fn() },
        updateMcp: { mutate: vi.fn() },
      },
      share: {
        create: { mutate: vi.fn() },
        getByToken: { query: vi.fn() },
        myShares: { query: vi.fn() },
        revoke: { mutate: vi.fn() },
      },
      skill: {
        checkPublishNameConflict: { query: vi.fn() },
        delistSkill: { mutate: vi.fn() },
        getMySkillList: { query: vi.fn() },
        installSkill: { mutate: vi.fn() },
        publishSkill: { mutate: vi.fn() },
        relistSkill: { mutate: vi.fn() },
        restoreSkillToLocal: { mutate: vi.fn() },
        updateInstalledSkill: { mutate: vi.fn() },
        updateSkill: { mutate: vi.fn() },
      },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

function resetMocks(obj: Record<string, any>) {
  for (const value of Object.values(obj)) {
    if (typeof value?.query?.mockReset === 'function') value.query.mockReset();
    else if (typeof value?.mutate?.mockReset === 'function') value.mutate.mockReset();
    else if (value && typeof value === 'object') resetMocks(value);
  }
}

describe('market command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const tempDir = mkdtempSync(join(tmpdir(), 'market-test-'));

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    resetMocks(mockTrpcClient.market);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  afterAll(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerMarketCommand(program);
    return program;
  }

  async function run(...args: string[]) {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'market', ...args]);
  }

  // ── agent ─────────────────────────────────────────────

  describe('agent', () => {
    it('list renders a table with total', async () => {
      mockTrpcClient.market.getAssistantList.query.mockResolvedValue({
        data: [
          {
            category: 'coding',
            identifier: 'demo-agent',
            installCount: 3,
            publisherName: 'Alice',
            title: 'Demo Agent',
            updatedAt: new Date(),
          },
        ],
        total: 1,
      });

      await run('agent', 'list');

      expect(mockTrpcClient.market.getAssistantList.query).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
      expect(consoleSpy.mock.calls[0][0]).toContain('IDENTIFIER');
      expect(consoleSpy.mock.calls[1][0]).toContain('demo-agent');
    });

    it('list passes keyword/category/sort filters', async () => {
      mockTrpcClient.market.getAssistantList.query.mockResolvedValue({ data: [], total: 0 });

      await run('agent', 'list', '-q', 'kw', '--category', 'coding', '--sort', 'installCount');

      expect(mockTrpcClient.market.getAssistantList.query).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'coding', keyword: 'kw', sortBy: 'installCount' }),
      );
    });

    it('list rejects invalid sort', async () => {
      await expect(run('agent', 'list', '--sort', 'bogus')).rejects.toThrow('Invalid sort');
    });

    it('list outputs JSON with --json', async () => {
      const items = [{ identifier: 'demo-agent' }];
      mockTrpcClient.market.getAssistantList.query.mockResolvedValue({ data: items, total: 1 });

      await run('agent', 'list', '--json');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(items, null, 2));
    });

    it('view exits when agent not found', async () => {
      mockTrpcClient.market.getAssistantDetail.query.mockResolvedValue(undefined);

      await expect(run('agent', 'view', 'missing')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('missing'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('install calls installAgent', async () => {
      mockTrpcClient.market.agent.installAgent.mutate.mockResolvedValue({ id: 'agt_1' });

      await run('agent', 'install', 'demo-agent');

      expect(mockTrpcClient.market.agent.installAgent.mutate).toHaveBeenCalledWith({
        identifier: 'demo-agent',
      });
      expect(consoleSpy.mock.calls[0][0]).toContain('Installed agent');
    });

    it('publish rejects invalid category and lists valid values', async () => {
      await expect(run('agent', 'publish', 'agt_1', '-c', 'bogus')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('data-analytics'));
      expect(mockTrpcClient.market.agent.publishAgent.mutate).not.toHaveBeenCalled();
    });

    it('publish aborts on display name conflict', async () => {
      mockTrpcClient.market.agent.checkPublishNameConflict.query.mockResolvedValue({
        conflict: true,
      });

      await expect(
        run('agent', 'publish', 'agt_1', '-c', 'coding', '--name', 'Taken'),
      ).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Taken'));
      expect(mockTrpcClient.market.agent.publishAgent.mutate).not.toHaveBeenCalled();
    });

    it('publish sends bundled identifiers', async () => {
      mockTrpcClient.market.agent.publishAgent.mutate.mockResolvedValue({ identifier: 'demo' });

      await run('agent', 'publish', 'agt_1', '-c', 'coding', '--skills', 'sk-a, sk-b');

      expect(mockTrpcClient.market.agent.publishAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agt_1',
          bundledSkillIdentifiers: ['sk-a', 'sk-b'],
          category: 'coding',
        }),
      );
    });

    it('delist with --yes skips confirmation', async () => {
      mockTrpcClient.market.agent.delistAgent.mutate.mockResolvedValue({});

      await run('agent', 'delist', 'demo-agent', '--yes');

      expect(mockTrpcClient.market.agent.delistAgent.mutate).toHaveBeenCalledWith({
        identifier: 'demo-agent',
      });
    });

    it('mine queries my published agents', async () => {
      mockTrpcClient.market.agent.getMyAssistantList.query.mockResolvedValue({
        data: [],
        total: 0,
      });

      await run('agent', 'mine');

      expect(mockTrpcClient.market.agent.getMyAssistantList.query).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
      expect(consoleSpy).toHaveBeenCalledWith('No published agents found.');
    });
  });

  // ── skill ─────────────────────────────────────────────

  describe('skill', () => {
    it('publish succeeds with valid category', async () => {
      mockTrpcClient.market.skill.publishSkill.mutate.mockResolvedValue({ identifier: 'my-sk' });

      await run('skill', 'publish', 'sk_1', '-c', 'deep-thinking');

      expect(mockTrpcClient.market.skill.publishSkill.mutate).toHaveBeenCalledWith({
        category: 'deep-thinking',
        newDisplayName: undefined,
        skillId: 'sk_1',
      });
      expect(consoleSpy.mock.calls[0][0]).toContain('my-sk');
    });

    it('restore calls restoreSkillToLocal', async () => {
      mockTrpcClient.market.skill.restoreSkillToLocal.mutate.mockResolvedValue({ id: 'sk_1' });

      await run('skill', 'restore', 'my-sk');

      expect(mockTrpcClient.market.skill.restoreSkillToLocal.mutate).toHaveBeenCalledWith({
        identifier: 'my-sk',
      });
    });

    it('upgrade calls updateInstalledSkill', async () => {
      mockTrpcClient.market.skill.updateInstalledSkill.mutate.mockResolvedValue({});

      await run('skill', 'upgrade', 'my-sk');

      expect(mockTrpcClient.market.skill.updateInstalledSkill.mutate).toHaveBeenCalledWith({
        identifier: 'my-sk',
      });
    });
  });

  // ── mcp ───────────────────────────────────────────────

  describe('mcp', () => {
    it('publish reads manifest and params files', async () => {
      const manifestPath = join(tempDir, 'manifest.json');
      const paramsPath = join(tempDir, 'params.json');
      writeFileSync(manifestPath, JSON.stringify({ identifier: 'my-mcp' }));
      writeFileSync(paramsPath, JSON.stringify({ apiKey: 'x' }));
      mockTrpcClient.market.mcp.publishMcp.mutate.mockResolvedValue({ identifier: 'my-mcp' });

      await run(
        'mcp',
        'publish',
        'my-mcp',
        '-c',
        'coding',
        '--manifest',
        manifestPath,
        '--params',
        paramsPath,
      );

      expect(mockTrpcClient.market.mcp.publishMcp.mutate).toHaveBeenCalledWith({
        category: 'coding',
        customParams: { apiKey: 'x' },
        identifier: 'my-mcp',
        manifest: { identifier: 'my-mcp' },
        newDisplayName: undefined,
      });
    });

    it('publish accepts an inline manifest JSON string (not just a file path)', async () => {
      mockTrpcClient.market.mcp.publishMcp.mutate.mockResolvedValue({ identifier: 'my-mcp' });

      await run(
        'mcp',
        'publish',
        'my-mcp',
        '-c',
        'coding',
        '--manifest',
        '{"identifier":"my-mcp"}',
      );

      expect(mockTrpcClient.market.mcp.publishMcp.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ manifest: { identifier: 'my-mcp' } }),
      );
    });

    it('publish exits when manifest file is unreadable', async () => {
      await expect(
        run('mcp', 'publish', 'my-mcp', '-c', 'coding', '--manifest', join(tempDir, 'nope.json')),
      ).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('manifest'));
      expect(mockTrpcClient.market.mcp.publishMcp.mutate).not.toHaveBeenCalled();
    });

    it('list supports createdAt sort', async () => {
      mockTrpcClient.market.getMcpList.query.mockResolvedValue({ data: [], total: 0 });

      await run('mcp', 'list', '--sort', 'createdAt');

      expect(mockTrpcClient.market.getMcpList.query).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'createdAt' }),
      );
    });
  });

  // ── kb ────────────────────────────────────────────────

  describe('kb', () => {
    it('publish has no category and passes display name', async () => {
      mockTrpcClient.market.knowledgeBase.checkPublishNameConflict.query.mockResolvedValue({
        conflict: false,
      });
      mockTrpcClient.market.knowledgeBase.publishKnowledgeBase.mutate.mockResolvedValue({
        identifier: 'my-kb',
      });

      await run('kb', 'publish', 'kb_1', '--name', 'My KB');

      expect(mockTrpcClient.market.knowledgeBase.publishKnowledgeBase.mutate).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb_1',
        newDisplayName: 'My KB',
      });
    });

    it('install calls installKnowledgeBase', async () => {
      mockTrpcClient.market.knowledgeBase.installKnowledgeBase.mutate.mockResolvedValue({});

      await run('kb', 'install', 'my-kb');

      expect(mockTrpcClient.market.knowledgeBase.installKnowledgeBase.mutate).toHaveBeenCalledWith({
        identifier: 'my-kb',
      });
    });
  });

  // ── share ─────────────────────────────────────────────

  describe('share', () => {
    it('create rejects invalid type', async () => {
      await expect(run('share', 'create', 'bogus', 'id_1')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('skill, mcp, agent'));
      expect(mockTrpcClient.market.share.create.mutate).not.toHaveBeenCalled();
    });

    it('create returns a token', async () => {
      mockTrpcClient.market.share.create.mutate.mockResolvedValue({ token: 'tok_1' });

      await run('share', 'create', 'skill', 'sk_1');

      expect(mockTrpcClient.market.share.create.mutate).toHaveBeenCalledWith({
        itemType: 'skill',
        localId: 'sk_1',
      });
      expect(consoleSpy.mock.calls.some((c) => String(c[0]).includes('tok_1'))).toBe(true);
    });

    it('list renders my shares', async () => {
      mockTrpcClient.market.share.myShares.query.mockResolvedValue([
        { createdAt: new Date(), installCount: 2, itemType: 'skill', name: 'S', token: 'tok_1' },
      ]);

      await run('share', 'list');

      expect(consoleSpy.mock.calls[0][0]).toContain('TOKEN');
      expect(consoleSpy.mock.calls[1][0]).toContain('tok_1');
    });

    it('revoke with --yes calls revoke', async () => {
      mockTrpcClient.market.share.revoke.mutate.mockResolvedValue({ success: true });

      await run('share', 'revoke', 'tok_1', '--yes');

      expect(mockTrpcClient.market.share.revoke.mutate).toHaveBeenCalledWith({ token: 'tok_1' });
    });
  });

  // ── top-level ─────────────────────────────────────────

  describe('top-level', () => {
    it('leaderboard renders sections', async () => {
      mockTrpcClient.market.getLeaderboard.query.mockResolvedValue({
        agents: [{ identifier: 'a1', publisherName: 'Alice', title: 'A1', usageCount: 9 }],
        mcps: [],
        skills: [],
      });

      await run('leaderboard', '--days', '7', '--limit', '3');

      expect(mockTrpcClient.market.getLeaderboard.query).toHaveBeenCalledWith({
        days: 7,
        limit: 3,
      });
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Agents');
      expect(output).toContain('a1');
    });

    it('unpublished renders rows for each type', async () => {
      mockTrpcClient.market.getUnpublishedResources.query.mockResolvedValue({
        agents: [{ action: 'publish', id: 'agt_1', title: 'My Agent' }],
        mcps: [],
        skills: [{ action: 'relist', id: 'sk_1', name: 'My Skill' }],
      });

      await run('unpublished');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('agt_1');
      expect(output).toContain('relist');
    });

    it('states marks delisted resources', async () => {
      mockTrpcClient.market.getPublisherResourceStates.query.mockResolvedValue({
        agents: [{ category: 'coding', deletedAt: null, identifier: 'a1', status: 'published' }],
        knowledgeBases: [],
        mcps: [],
        skills: [
          { category: 'other', deletedAt: new Date(), identifier: 's1', status: 'published' },
        ],
      });

      await run('states');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('published');
      expect(output).toContain('delisted');
    });
  });
});

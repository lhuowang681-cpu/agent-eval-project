import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerPluginCommand } from './plugin';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    plugin: {
      createOrInstallPlugin: { mutate: vi.fn() },
      createPlugin: { mutate: vi.fn() },
      getPlugins: { query: vi.fn() },
      removePlugin: { mutate: vi.fn() },
      updatePlugin: { mutate: vi.fn() },
    },
  },
}));

const { mockToolsClient } = vi.hoisted(() => ({
  mockToolsClient: {
    mcp: {
      getStreamableMcpServerManifest: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient, getToolsTrpcClient: mockGetToolsTrpcClient } = vi.hoisted(
  () => ({
    getToolsTrpcClient: vi.fn(),
    getTrpcClient: vi.fn(),
  }),
);

vi.mock('../api/client', () => ({
  getToolsTrpcClient: mockGetToolsTrpcClient,
  getTrpcClient: mockGetTrpcClient,
}));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('plugin command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const tempDir = mkdtempSync(join(tmpdir(), 'plugin-test-'));

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockGetToolsTrpcClient.mockResolvedValue(mockToolsClient);
    for (const method of Object.values(mockTrpcClient.plugin)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    mockToolsClient.mcp.getStreamableMcpServerManifest.query.mockReset();
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
    registerPluginCommand(program);
    return program;
  }

  describe('list', () => {
    it('should list plugins', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([
        { id: 'p1', identifier: 'search', type: 'plugin' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('should output JSON', async () => {
      const plugins = [{ id: 'p1', identifier: 'search' }];
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue(plugins);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(plugins, null, 2));
    });
  });

  describe('create', () => {
    it('should create a plugin', async () => {
      mockTrpcClient.plugin.createPlugin.mutate.mockResolvedValue({ identifier: 'my-plugin' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'create',
        '-i',
        'my-plugin',
        '--manifest',
        '{"name":"test"}',
      ]);

      expect(mockTrpcClient.plugin.createPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'my-plugin',
          manifest: { name: 'test' },
          type: 'plugin',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created plugin'));
    });

    it('should reject invalid manifest JSON', async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          'node',
          'test',
          'plugin',
          'create',
          '-i',
          'my-plugin',
          '--manifest',
          'not-json',
        ]),
      ).rejects.toThrow('process.exit');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid manifest'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('install', () => {
    it('should install a plugin', async () => {
      mockTrpcClient.plugin.createOrInstallPlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'my-plugin',
        '--manifest',
        '{"name":"test"}',
      ]);

      expect(mockTrpcClient.plugin.createOrInstallPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'my-plugin',
          manifest: { name: 'test' },
        }),
      );
    });

    it('should reject invalid manifest JSON', async () => {
      const program = createProgram();
      await expect(
        program.parseAsync([
          'node',
          'test',
          'plugin',
          'install',
          '-i',
          'my-plugin',
          '--manifest',
          'not-json',
        ]),
      ).rejects.toThrow('process.exit');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid manifest'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should accept a manifest file path (not just inline JSON)', async () => {
      mockTrpcClient.plugin.createOrInstallPlugin.mutate.mockResolvedValue({});
      const manifestPath = join(tempDir, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify({ name: 'test' }));

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'my-plugin',
        '--manifest',
        manifestPath,
      ]);

      expect(mockTrpcClient.plugin.createOrInstallPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ manifest: { name: 'test' } }),
      );
    });

    it('should pass through --custom-params for MCP connection info', async () => {
      mockTrpcClient.plugin.createOrInstallPlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'mcp-plugin',
        '--manifest',
        '{"name":"test"}',
        '--custom-params',
        '{"mcp":{"type":"http","url":"https://example.com/mcp"}}',
      ]);

      expect(mockTrpcClient.plugin.createOrInstallPlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
          identifier: 'mcp-plugin',
        }),
      );
    });

    it('should reject invalid custom-params JSON', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'install',
        '-i',
        'my-plugin',
        '--manifest',
        '{"name":"test"}',
        '--custom-params',
        'not-json',
      ]);

      expect(log.error).toHaveBeenCalledWith('Invalid custom-params JSON.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('uninstall', () => {
    it('should uninstall with --yes', async () => {
      mockTrpcClient.plugin.removePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'uninstall', 'p1', '--yes']);

      expect(mockTrpcClient.plugin.removePlugin.mutate).toHaveBeenCalledWith({ id: 'p1' });
    });
  });

  describe('update', () => {
    it('should update plugin settings', async () => {
      mockTrpcClient.plugin.updatePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'update',
        'p1',
        '--settings',
        '{"key":"value"}',
      ]);

      expect(mockTrpcClient.plugin.updatePlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', settings: { key: 'value' } }),
      );
    });

    it('should exit when no changes', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'update', 'p1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should update custom params', async () => {
      mockTrpcClient.plugin.updatePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'plugin',
        'update',
        'p1',
        '--custom-params',
        '{"mcp":{"type":"http","url":"https://example.com/mcp"}}',
      ]);

      expect(mockTrpcClient.plugin.updatePlugin.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
          id: 'p1',
        }),
      );
    });
  });

  describe('sync', () => {
    const existingPlugin = {
      customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
      identifier: 'mcp_test',
      manifest: { meta: { avatar: 'a.png', description: 'desc', title: 'Nice Title' } },
    };

    it('should sync real tools into the manifest and preserve the display title', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([existingPlugin]);
      mockToolsClient.mcp.getStreamableMcpServerManifest.query.mockResolvedValue({
        api: [{ name: 'toolA' }, { name: 'toolB' }],
        meta: { avatar: 'a.png', description: 'desc', title: 'mcp_test' },
      });
      mockTrpcClient.plugin.updatePlugin.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'sync', 'mcp_test']);

      expect(mockTrpcClient.plugin.updatePlugin.mutate).toHaveBeenCalledWith({
        id: 'mcp_test',
        manifest: expect.objectContaining({
          api: [{ name: 'toolA' }, { name: 'toolB' }],
          meta: expect.objectContaining({ title: 'Nice Title' }),
        }),
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Synced 2 tool(s)'));
    });

    it('should exit when the plugin is not found', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'sync', 'missing']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when customParams.mcp.url is missing', async () => {
      mockTrpcClient.plugin.getPlugins.query.mockResolvedValue([
        { ...existingPlugin, customParams: {} },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'plugin', 'sync', 'mcp_test']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('customParams.mcp.url'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import ToolDetectorCtr from '../ToolDetectorCtr';

const { execaMock, ipcMainHandleMock, portableInstall, portableReinstall, portableUninstall } =
  vi.hoisted(() => ({
    execaMock: vi.fn(),
    ipcMainHandleMock: vi.fn(),
    portableInstall: vi.fn(),
    portableReinstall: vi.fn(),
    portableUninstall: vi.fn(),
  }));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock('execa', () => ({
  execa: execaMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/modules/portableRuntime', () => ({
  getPortableRuntimeManager: () => ({
    install: portableInstall,
    on: vi.fn(),
    reinstall: portableReinstall,
    uninstall: portableUninstall,
  }),
}));

vi.mock('@/modules/portableRuntime/env', () => ({
  buildRuntimeEnvSyncFromDisk: (base: NodeJS.ProcessEnv = process.env) => base,
}));

const { readRuntimeMetaMock } = vi.hoisted(() => ({
  readRuntimeMetaMock: vi.fn(),
}));

vi.mock('@/modules/portableRuntime/meta', () => ({
  readRuntimeMeta: readRuntimeMetaMock,
}));

vi.mock('@/modules/portableRuntime/paths', () => ({
  getRuntimeBinDir: (name: string) => `/runtimes/${name}/bin`,
}));

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
};

describe('ToolDetectorCtr.installTool', () => {
  let ctr: ToolDetectorCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    readRuntimeMetaMock.mockResolvedValue({ version: '24.14.0' });
    ctr = new ToolDetectorCtr({
      toolDetectorManager: {
        clearCache: vi.fn(),
        detect: vi.fn(),
      },
    } as unknown as App);
  });

  it('installs node through the portable runtime manager on macOS', async () => {
    setPlatform('darwin');
    portableInstall.mockResolvedValue({ success: true, toolName: 'node', version: '24.14.0' });

    const result = await ctr.installTool('node');

    expect(result.success).toBe(true);
    expect(portableInstall).toHaveBeenCalledWith('node');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('installs python through the portable runtime manager on Windows', async () => {
    setPlatform('win32');
    portableInstall.mockResolvedValue({ success: true, toolName: 'python', version: '3.12.13' });

    const result = await ctr.installTool('python');

    expect(result.success).toBe(true);
    expect(portableInstall).toHaveBeenCalledWith('python');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('routes npm installation to the portable node runtime', async () => {
    setPlatform('darwin');
    portableInstall.mockResolvedValue({ success: true, toolName: 'node', version: '24.14.0' });

    const result = await ctr.installTool('npm');

    expect(result.success).toBe(true);
    expect(portableInstall).toHaveBeenCalledWith('node');
  });

  it('installs pnpm through portable npm -g when portable node is present', async () => {
    setPlatform('darwin');
    readRuntimeMetaMock.mockResolvedValue({ version: '24.14.0' });
    execaMock.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'added pnpm@9.15.0' });

    const result = await ctr.installTool('pnpm');

    expect(result.success).toBe(true);
    expect(portableInstall).not.toHaveBeenCalled();
    expect(execaMock).toHaveBeenCalledWith(
      '/runtimes/node/bin/npm',
      ['install', '-g', 'pnpm'],
      expect.any(Object),
    );
  });

  it('auto-installs portable node before installing pnpm globally', async () => {
    setPlatform('darwin');
    readRuntimeMetaMock
      .mockResolvedValueOnce(null) // first check: node not yet installed
      .mockResolvedValueOnce({ version: '24.14.0' }); // after portable install
    portableInstall.mockResolvedValue({ success: true, toolName: 'node', version: '24.14.0' });
    execaMock.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'added pnpm@9.15.0' });

    const result = await ctr.installTool('pnpm');

    expect(result.success).toBe(true);
    expect(portableInstall).toHaveBeenCalledWith('node');
    expect(execaMock).toHaveBeenCalledWith(
      '/runtimes/node/bin/npm',
      ['install', '-g', 'pnpm'],
      expect.any(Object),
    );
  });

  it('does not execute commands for system built-in tools', async () => {
    setPlatform('darwin');

    const result = await ctr.installTool('grep');

    expect(result.success).toBe(false);
    expect(result.error).toContain('不支持一键安装');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('rejects unknown tool names without executing commands', async () => {
    setPlatform('darwin');

    const result = await ctr.installTool('agent-browser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported tool');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('reinstalls node through the portable runtime manager', async () => {
    setPlatform('darwin');
    portableReinstall.mockResolvedValue({ success: true, toolName: 'node', version: '24.14.0' });

    const result = await ctr.reinstallTool('node');

    expect(result.success).toBe(true);
    expect(portableReinstall).toHaveBeenCalledWith('node');
  });

  it('uninstalls python through the portable runtime manager', async () => {
    setPlatform('darwin');
    portableUninstall.mockResolvedValue({ alreadyGone: false, success: true, toolName: 'python' });

    const result = await ctr.uninstallTool('python');

    expect(result.success).toBe(true);
    expect(portableUninstall).toHaveBeenCalledWith('python');
  });
});

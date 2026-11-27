import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionCtr from '../GatewayConnectionCtr';
import LocalFileCtr from '../LocalFileCtr';
import ShellCommandCtr from '../ShellCommandCtr';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/home/user') },
  ipcMain: { handle: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
}));

vi.mock('electron-is', () => ({
  dev: vi.fn(() => false),
  linux: vi.fn(() => false),
  macOS: vi.fn(() => true),
  windows: vi.fn(() => false),
}));

const makeCtr = (overrides: {
  localFile?: Partial<LocalFileCtr>;
  shell?: Partial<ShellCommandCtr>;
}) => {
  const localFile = overrides.localFile ?? {};
  const shell = overrides.shell ?? {};
  const app = {
    getController: (cls: unknown) => {
      if (cls === LocalFileCtr) return localFile;
      if (cls === ShellCommandCtr) return shell;
      return {};
    },
    getService: () => ({}),
    storeManager: { get: vi.fn(), set: vi.fn() },
  } as unknown as App;

  return new GatewayConnectionCtr(app);
};

// executeToolCall is private; reach it via a typed-loose handle.
const run = (ctr: GatewayConnectionCtr, apiName: string, args: unknown) =>
  (ctr as unknown as { executeToolCall: (a: string, b: unknown) => Promise<any> }).executeToolCall(
    apiName,
    args,
  );

describe('GatewayConnectionCtr.executeToolCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes runCommand to ShellCommandCtr and returns combined output (the lark-cli path)', async () => {
    const handleRunCommand = vi.fn().mockResolvedValue({
      exit_code: 0,
      stderr: '',
      stdout: '{"ok":true}',
      success: true,
    });
    const ctr = makeCtr({ shell: { handleRunCommand } as any });

    const result = await run(ctr, 'runCommand', { command: 'lark-cli --help' });

    expect(handleRunCommand).toHaveBeenCalledWith({ command: 'lark-cli --help' });
    expect(result.success).toBe(true);
    expect(result.content).toContain('{"ok":true}');
  });

  it('surfaces a non-zero exit code in runCommand content', async () => {
    const handleRunCommand = vi.fn().mockResolvedValue({
      exit_code: 2,
      stderr: 'boom',
      stdout: '',
      success: false,
    });
    const ctr = makeCtr({ shell: { handleRunCommand } as any });

    const result = await run(ctr, 'runCommand', { command: 'false' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('boom');
    expect(result.content).toContain('[exit code: 2]');
  });

  it('routes readLocalFile to LocalFileCtr.readFile', async () => {
    const readFile = vi.fn().mockResolvedValue({ content: 'hello', filename: 'a.txt' });
    const ctr = makeCtr({ localFile: { readFile } as any });

    const result = await run(ctr, 'readLocalFile', { path: '/tmp/a.txt' });

    expect(readFile).toHaveBeenCalledWith({ path: '/tmp/a.txt' });
    expect(result).toEqual({ content: 'hello', success: true });
  });

  it('resolves a relative grepContent path against scope before dispatch', async () => {
    const handleGrepContent = vi
      .fn()
      .mockResolvedValue({ matches: ['a.ts:1: hit'], success: true, total_matches: 1 });
    const ctr = makeCtr({ localFile: { handleGrepContent } as any });

    await run(ctr, 'grepContent', { path: 'src', pattern: 'foo', scope: '/work' });

    expect(handleGrepContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/work/src', pattern: 'foo' }),
    );
  });

  it('rejects unsupported api names', async () => {
    const ctr = makeCtr({});
    const result = await run(ctr, 'somethingElse', {});
    expect(result).toEqual({
      content: 'Unsupported local-system apiName "somethingElse"',
      error: 'unsupported_api',
      success: false,
    });
  });
});

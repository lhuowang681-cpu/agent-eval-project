import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import PowerCtr from '../PowerCtr';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 42), stop: vi.fn() },
}));

const macOSMock = vi.fn(() => true);
vi.mock('electron-is', () => ({
  dev: vi.fn(() => false),
  linux: vi.fn(() => false),
  macOS: () => macOSMock(),
  windows: vi.fn(() => false),
}));

// Callback-style mock so `promisify(execFile)` wraps it into a promise.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args),
}));

const makeCtr = () => {
  const store = new Map<string, unknown>();
  const storeManager = {
    get: vi.fn((key: string, def?: unknown) => (store.has(key) ? store.get(key) : def)),
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
  };
  const app = { storeManager } as unknown as App;
  return { ctr: new PowerCtr(app), storeManager };
};

// osascript succeeds
const authOk = () =>
  execFileMock.mockImplementation((_cmd, _args, cb: any) => cb(null, { stdout: '', stderr: '' }));
// user cancels the admin dialog
const authCancel = () =>
  execFileMock.mockImplementation((_cmd, _args, cb: any) => cb(new Error('User canceled.')));

describe('PowerCtr.setPreventSleep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    macOSMock.mockReturnValue(true);
  });

  it('enables: starts blocker, sets disablesleep 1, persists true', async () => {
    const { powerSaveBlocker } = await import('electron');
    authOk();
    const { ctr, storeManager } = makeCtr();

    const result = await ctr.setPreventSleep(true);

    expect(result.success).toBe(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
    const script = execFileMock.mock.calls[0][1][1] as string;
    expect(script).toContain('pmset -a disablesleep 1');
    expect(storeManager.set).toHaveBeenCalledWith('preventSleep', true);
  });

  it('rolls back and does not persist when admin auth is cancelled', async () => {
    const { powerSaveBlocker } = await import('electron');
    authCancel();
    const { ctr, storeManager } = makeCtr();

    const result = await ctr.setPreventSleep(true);

    expect(result.success).toBe(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(42);
    expect(storeManager.set).not.toHaveBeenCalledWith('preventSleep', true);
  });

  it('disables: stops blocker, sets disablesleep 0, persists false', async () => {
    const { powerSaveBlocker } = await import('electron');
    authOk();
    const { ctr, storeManager } = makeCtr();
    // enable first so there is a blocker id to stop
    await ctr.setPreventSleep(true);
    vi.mocked(powerSaveBlocker.stop).mockClear();
    execFileMock.mockClear();

    const result = await ctr.setPreventSleep(false);

    expect(result.success).toBe(true);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(42);
    const script = execFileMock.mock.calls[0][1][1] as string;
    expect(script).toContain('pmset -a disablesleep 0');
    expect(storeManager.set).toHaveBeenCalledWith('preventSleep', false);
  });

  it('non-macOS: only toggles the blocker, no osascript', async () => {
    macOSMock.mockReturnValue(false);
    const { powerSaveBlocker } = await import('electron');
    const { ctr, storeManager } = makeCtr();

    const result = await ctr.setPreventSleep(true);

    expect(result.success).toBe(true);
    expect(powerSaveBlocker.start).toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(storeManager.set).toHaveBeenCalledWith('preventSleep', true);
  });
});

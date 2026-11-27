import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, execMock, platformMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execMock: vi.fn(),
  platformMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: execMock,
  execFile: execFileMock,
}));

vi.mock('node:os', async () => ({
  platform: platformMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/detector-test-userdata' },
}));

vi.mock('@/modules/portableRuntime/meta', () => ({
  readRuntimeMeta: vi.fn().mockResolvedValue(null),
}));

const resolveExecFile = (stdout: string, stderr = '') => ({
  stderr,
  stdout,
});

describe('runtimeEnvironmentDetectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    platformMock.mockReturnValue('win32');
  });

  it('does not mark the Windows Python Store alias as available when --version fails', async () => {
    execFileMock.mockImplementation((command, args, _options, callback) => {
      if (command === 'where' && args[0] === 'python') {
        callback(
          null,
          resolveExecFile(
            'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe\r\n',
          ),
        );
        return;
      }

      if (command === 'where' && args[0] === 'py') {
        callback(new Error('not found'));
        return;
      }

      if (String(command).endsWith('python.exe') && args[0] === '--version') {
        callback(new Error('store alias cannot run'));
        return;
      }

      callback(new Error(`Unexpected command: ${command}`));
    });

    const { pythonDetector } = await import('./runtimeEnvironmentDetectors');

    await expect(pythonDetector.detect()).resolves.toEqual({ available: false });
  });
});

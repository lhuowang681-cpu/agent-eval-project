import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (k: string) => (k === 'userData' ? '/tmp/testUserData' : ''),
  },
}));

const { assertInsideRuntimesRoot, getRuntimeBinDir, getRuntimeDir, getRuntimesRoot } =
  await import('../paths');

describe('paths', () => {
  it('getRuntimesRoot returns userData/runtimes', () => {
    expect(getRuntimesRoot()).toBe(path.join('/tmp/testUserData', 'runtimes'));
  });

  it('getRuntimeDir returns runtimes/{name}', () => {
    expect(getRuntimeDir('python')).toBe(path.join('/tmp/testUserData', 'runtimes', 'python'));
  });

  it('getRuntimeBinDir returns platform-specific bin subdir', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    expect(getRuntimeBinDir('python')).toBe(
      path.join('/tmp/testUserData', 'runtimes', 'python', 'bin'),
    );
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    expect(getRuntimeBinDir('python')).toBe(path.join('/tmp/testUserData', 'runtimes', 'python'));
  });

  describe('assertInsideRuntimesRoot', () => {
    it('accepts paths inside runtimes root', () => {
      expect(() =>
        assertInsideRuntimesRoot(path.join('/tmp/testUserData', 'runtimes', 'python')),
      ).not.toThrow();
    });

    it('rejects paths outside runtimes root', () => {
      expect(() => assertInsideRuntimesRoot('/etc/passwd')).toThrow(/path escape/i);
    });

    it('rejects parent-relative escapes', () => {
      expect(() =>
        assertInsideRuntimesRoot(path.join('/tmp/testUserData', 'runtimes', '..', 'evil')),
      ).toThrow(/path escape/i);
    });
  });
});

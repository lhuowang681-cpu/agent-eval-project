import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/testUD' },
}));

const { buildRuntimeEnvSync } = await import('../env');

describe('buildRuntimeEnvSync', () => {
  it('prepends bin dirs to PATH (posix)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync(['/rt/python/bin', '/rt/node'], {
      PATH: '/usr/bin:/bin',
    });
    expect(result.PATH).toBe('/rt/python/bin:/rt/node:/usr/bin:/bin');
  });

  it('deduplicates PATH entries', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync(['/rt/python/bin'], {
      PATH: '/rt/python/bin:/usr/bin',
    });
    expect(result.PATH).toBe('/rt/python/bin:/usr/bin');
  });

  it('sets both PATH and Path on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const result = buildRuntimeEnvSync(['C:\\rt\\python'], {
      Path: 'C:\\Windows',
    });
    expect(result.PATH).toBe('C:\\rt\\python;C:\\Windows');
    expect(result.Path).toBe('C:\\rt\\python;C:\\Windows');
  });

  it('preserves other env vars', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync([], {
      FOO: 'bar',
      PATH: '/usr/bin',
    });
    expect(result.FOO).toBe('bar');
  });
});

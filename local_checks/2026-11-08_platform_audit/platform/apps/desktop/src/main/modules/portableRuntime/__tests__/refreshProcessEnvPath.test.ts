import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP = path.join(os.tmpdir(), `pbrm-refresh-${process.pid}`);

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? TMP : '') },
}));

const META_FILE = '.calcifer-meta.json';

async function loadFresh() {
  // Fresh module instance so the internal snapshot resets between tests.
  vi.resetModules();
  return {
    env: await import('../env'),
    paths: await import('../paths'),
  };
}

function writeInstalled(runtimeDir: string) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, META_FILE), JSON.stringify({ version: 'x' }));
}

describe('refreshProcessEnvPath', () => {
  const originalPath = process.env.PATH;
  const originalPathCased = process.env.Path;

  beforeEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalPathCased === undefined) delete process.env.Path;
    else process.env.Path = originalPathCased;
    fs.rmSync(TMP, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('prepends installed runtime bin dirs to process.env.PATH', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    process.env.PATH = '/usr/bin:/bin';
    const { env, paths } = await loadFresh();
    writeInstalled(paths.getRuntimeDir('node'));

    env.refreshProcessEnvPath();

    const nodeBin = paths.getRuntimeBinDir('node');
    expect(process.env.PATH!.split(':')).toContain(nodeBin);
    expect(process.env.PATH!.startsWith(nodeBin)).toBe(true);
  });

  it('is idempotent across repeated calls', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    process.env.PATH = '/usr/bin:/bin';
    const { env, paths } = await loadFresh();
    writeInstalled(paths.getRuntimeDir('node'));

    env.refreshProcessEnvPath();
    const first = process.env.PATH;
    env.refreshProcessEnvPath();
    env.refreshProcessEnvPath();
    expect(process.env.PATH).toBe(first);
  });

  it('drops the bin from PATH after uninstall', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    process.env.PATH = '/usr/bin:/bin';
    const { env, paths } = await loadFresh();
    writeInstalled(paths.getRuntimeDir('node'));

    env.refreshProcessEnvPath();
    const nodeBin = paths.getRuntimeBinDir('node');
    expect(process.env.PATH!.split(':')).toContain(nodeBin);

    fs.rmSync(paths.getRuntimeDir('node'), { recursive: true, force: true });
    env.refreshProcessEnvPath();
    expect(process.env.PATH!.split(':')).not.toContain(nodeBin);
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });

  it('sets both PATH and Path on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    process.env.PATH = 'C:\\Windows';
    process.env.Path = 'C:\\Windows';
    const { env, paths } = await loadFresh();
    writeInstalled(paths.getRuntimeDir('node'));

    env.refreshProcessEnvPath();

    const nodeBin = paths.getRuntimeBinDir('node');
    expect(process.env.PATH!.split(';')).toContain(nodeBin);
    expect(process.env.Path).toBe(process.env.PATH);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP = path.join(os.tmpdir(), `pbrm-test-${process.pid}`);

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? TMP : '') },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  }),
}));

vi.mock('../download', () => ({
  DownloadError: class DownloadError extends Error {},
  VerifyMismatchError: class VerifyMismatchError extends Error {},
  downloadWithSha256: vi.fn(async (_url: string, dest: string) => {
    await fs.writeFile(dest, 'fake-archive');
  }),
  fetchNodeSha256: vi.fn(async () => 'deadbeef'),
  parseShasumsFile: vi.fn(),
}));

vi.mock('../extract', () => ({
  extractArchive: vi.fn(async (_a: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'python.exe'), 'fake');
  }),
}));

const { PortableRuntimeManager } = await import('../PortableRuntimeManager');
const { readRuntimeMeta } = await import('../meta');

describe('PortableRuntimeManager', () => {
  let mgr: InstanceType<typeof PortableRuntimeManager>;

  beforeEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(TMP, { recursive: true });
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
    mgr = new PortableRuntimeManager();
  });

  afterEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it('install writes meta and executable', async () => {
    const result = await mgr.install('python');
    expect(result.success).toBe(true);
    const meta = await readRuntimeMeta('python');
    expect(meta?.version).toBe('3.12.13');
    const exePath = path.join(TMP, 'runtimes', 'python', 'python.exe');
    await expect(fs.access(exePath)).resolves.toBeUndefined();
  });

  it('install skips when version matches and not forced', async () => {
    await mgr.install('python');
    const second = await mgr.install('python');
    expect(second.skipped).toBe(true);
  });

  it('reinstall force-runs install', async () => {
    await mgr.install('python');
    const result = await mgr.reinstall('python');
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });

  it('uninstall removes runtime dir', async () => {
    await mgr.install('python');
    const un = await mgr.uninstall('python');
    expect(un.success).toBe(true);
    const meta = await readRuntimeMeta('python');
    expect(meta).toBeNull();
  });

  it('uninstall returns alreadyGone when not installed', async () => {
    const un = await mgr.uninstall('python');
    expect(un.success).toBe(true);
    expect(un.alreadyGone).toBe(true);
  });

  it('emits progress events', async () => {
    const events: string[] = [];
    mgr.on('progress', (e) => events.push(e.phase));
    await mgr.install('python', { force: true });
    expect(events).toContain('download');
    expect(events).toContain('verify');
    expect(events).toContain('extract');
    expect(events).toContain('switch');
    expect(events).toContain('done');
  });
});

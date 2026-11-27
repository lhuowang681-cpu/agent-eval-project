import fs from 'node:fs';
import path from 'node:path';

import { readRuntimeMeta } from './meta';
import { getRuntimeBinDir, getRuntimeDir } from './paths';
import type { RuntimeName } from './types';

const ALL_RUNTIMES: RuntimeName[] = ['python', 'node', 'bun', 'uv', 'rg', 'fd'];
const META_FILE = '.calcifer-meta.json';

export async function listInstalledRuntimeBinDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const name of ALL_RUNTIMES) {
    const meta = await readRuntimeMeta(name);
    if (meta) dirs.push(getRuntimeBinDir(name));
  }
  return dirs;
}

export function listInstalledRuntimeBinDirsSync(): string[] {
  const dirs: string[] = [];
  for (const name of ALL_RUNTIMES) {
    const metaPath = path.join(getRuntimeDir(name), META_FILE);
    try {
      if (fs.existsSync(metaPath)) dirs.push(getRuntimeBinDir(name));
    } catch {
      // ignore
    }
  }
  return dirs;
}

export function buildRuntimeEnvSync(
  binDirs: string[],
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts: string[] = [];
  for (const b of binDirs) parts.push(b);
  if (base.PATH) parts.push(base.PATH);
  if (process.platform === 'win32' && base.Path && base.Path !== base.PATH) {
    parts.push(base.Path);
  }

  const seen = new Set<string>();
  const merged = parts
    .flatMap((p) => p.split(sep))
    .map((p) => p.trim())
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join(sep);

  const next: NodeJS.ProcessEnv = { ...base, PATH: merged };
  if (process.platform === 'win32') {
    next.Path = merged;
  }
  return next;
}

export async function buildRuntimeEnv(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const dirs = await listInstalledRuntimeBinDirs();
  return buildRuntimeEnvSync(dirs, base);
}

export function buildRuntimeEnvSyncFromDisk(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return buildRuntimeEnvSync(listInstalledRuntimeBinDirsSync(), base);
}

/**
 * Rewrite the current process's PATH so subsequent child_process.spawn() calls
 * inherit portable runtime bin dirs. Idempotent: builds from an untouched base
 * snapshot every time, so repeated calls don't accumulate duplicated segments.
 *
 * The base snapshot is captured on first call and reused afterwards, so if the
 * user uninstalls a runtime we can drop it out of PATH by rebuilding from the
 * original PATH the app started with.
 */
let originalEnvSnapshot: { PATH?: string; Path?: string } | undefined;

export function refreshProcessEnvPath(): void {
  if (!originalEnvSnapshot) {
    originalEnvSnapshot = { PATH: process.env.PATH, Path: process.env.Path };
  }
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: originalEnvSnapshot.PATH,
    Path: originalEnvSnapshot.Path,
  };
  const next = buildRuntimeEnvSync(listInstalledRuntimeBinDirsSync(), base);
  process.env.PATH = next.PATH;
  if (process.platform === 'win32') {
    process.env.Path = next.Path;
  }
}

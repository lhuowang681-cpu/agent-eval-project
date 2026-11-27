import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/utils/logger';

import { assertInsideRuntimesRoot, getRuntimesRoot } from './paths';

const logger = createLogger('portableRuntime:cleanup');

const STALE_PATTERNS = [/\.tmp-(\d+)$/, /\.new$/, /\.old-\d+$/];

function isSafeToRemove(name: string): boolean {
  const tmpMatch = /\.tmp-(\d+)$/.exec(name);
  if (tmpMatch) {
    const pid = Number(tmpMatch[1]);
    if (pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }
  return true;
}

export async function cleanupStaleDirs(): Promise<void> {
  const root = getRuntimesRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return;
    throw e;
  }

  await Promise.all(
    entries
      .filter((name) => STALE_PATTERNS.some((r) => r.test(name)))
      .filter((name) => isSafeToRemove(name))
      .map(async (name) => {
        const full = path.join(root, name);
        try {
          assertInsideRuntimesRoot(full);
          await fs.rm(full, { recursive: true, force: true });
          logger.debug(`cleaned stale dir: ${name}`);
        } catch (e) {
          logger.warn(`failed to clean ${name}:`, e);
        }
      }),
  );
}

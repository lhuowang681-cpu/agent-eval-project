import fs from 'node:fs/promises';
import path from 'node:path';

import { getRuntimeDir } from './paths';
import type { RuntimeMetaFile, RuntimeName } from './types';

const META_FILENAME = '.calcifer-meta.json';

export async function readRuntimeMeta(name: RuntimeName): Promise<RuntimeMetaFile | null> {
  const file = path.join(getRuntimeDir(name), META_FILENAME);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as RuntimeMetaFile;
  } catch {
    return null;
  }
}

export async function writeRuntimeMeta(dir: string, meta: RuntimeMetaFile): Promise<void> {
  const file = path.join(dir, META_FILENAME);
  await fs.writeFile(file, JSON.stringify(meta, null, 2), 'utf8');
}

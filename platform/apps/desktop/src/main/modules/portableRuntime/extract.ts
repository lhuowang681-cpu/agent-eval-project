import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { unzipSync } from 'fflate';

import type { ArchiveFormat } from './types';

function isUnsafeEntryName(name: string): boolean {
  if (!name) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-z]:/i.test(name)) return true;
  const parts = name.split(/[/\\]/);
  return parts.includes('..');
}

async function extractZip(archivePath: string, destDir: string, rootPrefix: string): Promise<void> {
  const buf = await fs.readFile(archivePath);
  const entries = unzipSync(buf);
  const prefix = rootPrefix ?? '';
  const destResolved = path.resolve(destDir);

  for (const [name, data] of Object.entries(entries)) {
    if (isUnsafeEntryName(name)) {
      throw new Error(`Refused: unsafe zip entry name: ${name}`);
    }
    let rel = name;
    if (prefix) {
      if (!rel.startsWith(prefix)) continue;
      rel = rel.slice(prefix.length);
    }
    if (!rel) continue;

    const outPath = path.join(destDir, rel);
    const resolved = path.resolve(outPath);
    if (resolved !== destResolved && !resolved.startsWith(destResolved + path.sep)) {
      throw new Error(`Refused: zip slip attempt: ${name}`);
    }
    if (name.endsWith('/')) {
      await fs.mkdir(outPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, data);
    }
  }
}

async function extractTarViaSystemTar(
  archivePath: string,
  destDir: string,
  rootPrefix: string,
  format: 'tar.gz' | 'tar.xz',
): Promise<void> {
  const strip = rootPrefix ? rootPrefix.replace(/\/$/, '').split('/').length : 0;
  const flag = format === 'tar.gz' ? '-xzf' : '-xJf';
  const args = [flag, archivePath, '-C', destDir];
  if (strip > 0) {
    args.push('--strip-components', String(strip));
  }
  await execa('tar', args, { timeout: 5 * 60 * 1000, windowsHide: true });
}

async function extractRaw(
  archivePath: string,
  destDir: string,
  executableName: string,
): Promise<void> {
  const outPath = path.join(destDir, executableName);
  const resolved = path.resolve(outPath);
  const destResolved = path.resolve(destDir);
  if (!resolved.startsWith(destResolved + path.sep)) {
    throw new Error(`Refused: raw extract path escape: ${outPath}`);
  }
  const data = await fs.readFile(archivePath);
  await fs.writeFile(outPath, data);
  if (process.platform !== 'win32') {
    await fs.chmod(outPath, 0o755);
  }
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  format: ArchiveFormat,
  rootPrefix: string,
  executableName?: string,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (format === 'zip') {
    await extractZip(archivePath, destDir, rootPrefix);
    return;
  }
  if (format === 'raw') {
    if (!executableName) {
      throw new Error('extractArchive: raw format requires executableName');
    }
    await extractRaw(archivePath, destDir, executableName);
    return;
  }
  await extractTarViaSystemTar(archivePath, destDir, rootPrefix, format);
}

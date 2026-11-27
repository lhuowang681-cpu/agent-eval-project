import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractArchive } from '../extract';

describe('extractArchive (zip)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('extracts a well-formed zip and strips rootPrefix', async () => {
    const zip = zipSync({
      'node-v24.14.0-win-x64/node.exe': strToU8('fake-node-binary'),
      'node-v24.14.0-win-x64/npm.cmd': strToU8('fake-npm'),
    });
    const zipPath = path.join(tmp, 'test.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await extractArchive(zipPath, dest, 'zip', 'node-v24.14.0-win-x64/');
    expect(await fs.readFile(path.join(dest, 'node.exe'), 'utf8')).toBe('fake-node-binary');
    expect(await fs.readFile(path.join(dest, 'npm.cmd'), 'utf8')).toBe('fake-npm');
  });

  it('rejects zip slip (../)', async () => {
    const zip = zipSync({
      '../evil.txt': strToU8('bad'),
    });
    const zipPath = path.join(tmp, 'evil.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await expect(extractArchive(zipPath, dest, 'zip', '')).rejects.toThrow(/unsafe|slip|escape/i);
  });

  it('rejects absolute path entries', async () => {
    const zip = zipSync({
      '/etc/passwd': strToU8('bad'),
    });
    const zipPath = path.join(tmp, 'abs.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await expect(extractArchive(zipPath, dest, 'zip', '')).rejects.toThrow(
      /unsafe|absolute|escape/i,
    );
  });
});

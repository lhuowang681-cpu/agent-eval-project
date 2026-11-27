import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeLocalFile } from '../write';

// Verify-after-write regression coverage for the production bug where a write was
// reported as success but nothing landed on disk, so a follow-up command failed
// with "no such file". We trigger the mismatch deterministically (no module mock,
// which is unreliable for node: builtins under bun) by writing to /dev/null:
// the write call succeeds yet stat() reports 0 bytes — exactly the silent no-op.
const isPosix = process.platform !== 'win32';

describe('writeLocalFile verify-after-write', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-verify-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('still succeeds on a real, complete write (incl. multi-byte content)', async () => {
    const filePath = path.join(tmpDir, 'ok.txt');
    const result = await writeLocalFile({ content: 'hello 世界', path: filePath });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello 世界');
  });

  it.runIf(isPosix)('fails loudly when the bytes do not land on disk', async () => {
    // /dev/null accepts the write but persists 0 bytes — the silent no-op case.
    const result = await writeLocalFile({ content: 'this content vanishes', path: '/dev/null' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('verification failed');
  });
});

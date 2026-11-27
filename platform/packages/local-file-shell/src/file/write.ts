import { Buffer } from 'node:buffer';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WriteFileParams, WriteFileResult } from '../types';
import { resolveAgainstCwd } from './expandTilde';

export async function writeLocalFile({
  path: rawPath,
  content,
  cwd,
}: WriteFileParams): Promise<WriteFileResult> {
  const filePath = resolveAgainstCwd(rawPath, cwd) ?? rawPath;
  if (!filePath) return { error: 'Path cannot be empty', success: false };
  if (content === undefined) return { error: 'Content cannot be empty', success: false };

  try {
    const dirname = path.dirname(filePath);
    await mkdir(dirname, { recursive: true });
    await writeFile(filePath, content, 'utf8');

    // Verify the write actually landed on disk before reporting success.
    // A silent no-op / partial write would otherwise be reported as success and
    // mislead downstream steps (e.g. a follow-up command that reads the file then
    // fails with "no such file"). Surface it here as a loud, actionable error.
    const expectedBytes = Buffer.byteLength(content, 'utf8');
    const { size } = await stat(filePath);
    if (size !== expectedBytes) {
      return {
        error: `File write verification failed: expected ${expectedBytes} bytes but found ${size} on disk at ${filePath}`,
        success: false,
      };
    }

    return { success: true };
  } catch (error) {
    return { error: `Failed to write file: ${(error as Error).message}`, success: false };
  }
}

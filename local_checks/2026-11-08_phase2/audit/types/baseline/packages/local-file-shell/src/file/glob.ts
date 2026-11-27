import fg from 'fast-glob';

import type { GlobFilesParams, GlobFilesResult } from '../types';
import { resolveAgainstCwd } from './expandTilde';

export async function globLocalFiles({
  pattern,
  cwd,
  scope,
}: GlobFilesParams): Promise<GlobFilesResult> {
  try {
    const files = await fg(pattern, {
      cwd: resolveAgainstCwd(scope, cwd) ?? resolveAgainstCwd(cwd) ?? process.cwd(),
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
    return { files };
  } catch (error) {
    return { error: (error as Error).message, files: [] };
  }
}

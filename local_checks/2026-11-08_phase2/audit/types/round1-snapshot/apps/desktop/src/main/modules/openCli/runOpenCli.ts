import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import { openCliRunner } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:openCli');

export interface RunOpenCliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * Run the vendored OpenCLI entry with Electron's built-in Node
 * (ELECTRON_RUN_AS_NODE=1), so the user does not need a system Node >= 20.
 */
export const runOpenCli = (
  args: string[],
  options: { timeout?: number } = {},
): Promise<RunOpenCliResult> => {
  const { timeout = DEFAULT_TIMEOUT } = options;

  if (!existsSync(openCliRunner)) {
    return Promise.resolve({
      exitCode: -1,
      stderr: `OpenCLI runner not found: ${openCliRunner}`,
      stdout: '',
    });
  }

  return new Promise((resolve) => {
    logger.debug(`Running opencli: ${args.join(' ')}`);
    execFile(
      process.execPath,
      [openCliRunner, ...args],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        // `opencli doctor` can emit verbose diagnostics; the default 1 MB cap would
        // kill the child mid-run and surface as exitCode 1 + truncated stderr,
        // misreporting a healthy bridge as "not connected".
        maxBuffer: 10 * 1024 * 1024,
        timeout,
      },
      (error, stdout, stderr) => {
        // execFile passes a non-null error on non-zero exit / timeout; we still
        // want the captured output and a numeric exit code for the caller.
        const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ exitCode, stderr: stderr ?? '', stdout: stdout ?? '' });
      },
    );
  });
};

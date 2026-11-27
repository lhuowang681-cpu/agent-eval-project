import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import { larkCliBin, larkCliHome } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:feishuCli:shim');

/**
 * Make the BUNDLED `lark-cli` win on PATH for skill `execScript` shell commands.
 *
 * binDir is only *appended* to PATH (fallback semantics), so a user's own
 * system-wide `lark-cli` would shadow the bundled one — and then the model's
 * `lark-cli ...` commands (PATH-resolved) would use a different binary/version
 * than the Feishu settings controller (which spawns the bundled binary by
 * absolute path), splitting auth/config. We generate a tiny launcher that execs
 * the bundled binary and prepend it so both paths agree on the version we ship
 * and test.
 *
 * No-op when lark-cli is not bundled (e.g. dev without running download:lark-cli).
 */
export const ensureLarkCliShim = (): void => {
  if (!existsSync(larkCliBin)) {
    logger.debug(`lark-cli binary not found, skipping shim: ${larkCliBin}`);
    return;
  }

  try {
    const shimDir = join(app.getPath('userData'), 'lark-cli-bin');
    mkdirSync(shimDir, { recursive: true });
    // Isolated config/login home, shared with the controller (see larkCliHome).
    mkdirSync(larkCliHome, { recursive: true });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const shimPath = join(shimDir, 'lark-cli.cmd');
      writeFileSync(
        shimPath,
        [
          '@echo off',
          `set "HOME=${larkCliHome}"`,
          `set "USERPROFILE=${larkCliHome}"`,
          `"${larkCliBin}" %*`,
          '',
        ].join('\r\n'),
        'utf8',
      );
    } else {
      const shimPath = join(shimDir, 'lark-cli');
      writeFileSync(
        shimPath,
        ['#!/bin/sh', `HOME="${larkCliHome}" exec "${larkCliBin}" "$@"`, ''].join('\n'),
        'utf8',
      );
      chmodSync(shimPath, 0o755);
    }

    // Prepend so the bundled lark-cli wins over any system-wide install.
    const pathSep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${shimDir}${pathSep}${process.env.PATH}`;
    logger.info(`lark-cli shim ready, prepended to PATH: ${shimDir}`);
  } catch (error) {
    logger.error('Failed to create lark-cli shim:', error);
  }
};

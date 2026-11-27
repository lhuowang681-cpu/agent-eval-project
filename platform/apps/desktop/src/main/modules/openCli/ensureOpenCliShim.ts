import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import { openCliRunner } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:openCli:shim');

/**
 * Make `opencli` resolvable on PATH for skill `execScript` shell commands.
 *
 * OpenCLI is vendored as a JS package run through Electron's built-in Node
 * (ELECTRON_RUN_AS_NODE) via the argv-normalizing `run.cjs`, so — unlike the
 * agent-browser binary — it cannot just live in `binDir`. We instead generate a
 * tiny launcher into a writable dir (the packaged Resources tree is read-only)
 * and prepend it to PATH. The launcher embeds the runtime-only `process.execPath`
 * and the runner path, so it must be regenerated each launch.
 *
 * No-op when OpenCLI is not vendored (e.g. dev without running install:opencli).
 */
export const ensureOpenCliShim = (): void => {
  if (!existsSync(openCliRunner)) {
    logger.debug(`OpenCLI runner not found, skipping shim: ${openCliRunner}`);
    return;
  }

  try {
    const shimDir = join(app.getPath('userData'), 'opencli-bin');
    mkdirSync(shimDir, { recursive: true });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const shimPath = join(shimDir, 'opencli.cmd');
      writeFileSync(
        shimPath,
        [
          '@echo off',
          'set "ELECTRON_RUN_AS_NODE=1"',
          `"${process.execPath}" "${openCliRunner}" %*`,
          '',
        ].join('\r\n'),
        'utf8',
      );
    } else {
      const shimPath = join(shimDir, 'opencli');
      writeFileSync(
        shimPath,
        [
          '#!/bin/sh',
          `ELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${openCliRunner}" "$@"`,
          '',
        ].join('\n'),
        'utf8',
      );
      chmodSync(shimPath, 0o755);
    }

    // Prepend so the bundled OpenCLI wins over any system-wide install.
    const pathSep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${shimDir}${pathSep}${process.env.PATH}`;
    logger.info(`OpenCLI shim ready, prepended to PATH: ${shimDir}`);
  } catch (error) {
    logger.error('Failed to create OpenCLI shim:', error);
  }
};

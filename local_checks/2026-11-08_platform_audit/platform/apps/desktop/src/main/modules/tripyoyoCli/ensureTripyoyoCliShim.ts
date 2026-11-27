import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tripyoyoCliRunner, tripyoyoCliShimDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:tripyoyoCli:shim');

// bin names exposed by @ctrip/tripyoyo-cli (see apps/cli/package.json `bin`).
// `tripyoyo` is the canonical name; `lh` / `yoyo` are aliases.
const BIN_NAMES = ['tripyoyo', 'lh', 'yoyo'] as const;

/**
 * Make the bundled tripyoyo CLI resolvable on PATH as `tripyoyo` / `lh` / `yoyo`.
 *
 * The CLI ships as a single-file JS bundle run through Electron's built-in Node
 * (ELECTRON_RUN_AS_NODE) via `tripyoyoCliRunner`, so — like OpenCLI and unlike the
 * native lark-cli binary — it cannot just live in `binDir`. We generate tiny
 * launchers into a writable dir (the packaged Resources tree is read-only) and
 * prepend it to PATH. The launcher embeds the runtime-only `process.execPath` and
 * the runner path, so it must be regenerated each launch (paths change across
 * auto-updates).
 *
 * No-op when the CLI bundle is absent (e.g. dev without `bun --cwd apps/cli build`).
 */
export const ensureTripyoyoCliShim = (): void => {
  if (!existsSync(tripyoyoCliRunner)) {
    logger.debug(`tripyoyo CLI bundle not found, skipping shim: ${tripyoyoCliRunner}`);
    return;
  }

  try {
    const shimDir = tripyoyoCliShimDir;
    mkdirSync(shimDir, { recursive: true });

    const isWindows = process.platform === 'win32';
    for (const name of BIN_NAMES) {
      if (isWindows) {
        writeFileSync(
          join(shimDir, `${name}.cmd`),
          [
            '@echo off',
            'set "ELECTRON_RUN_AS_NODE=1"',
            `"${process.execPath}" "${tripyoyoCliRunner}" %*`,
            '',
          ].join('\r\n'),
          'utf8',
        );
      } else {
        const shimPath = join(shimDir, name);
        writeFileSync(
          shimPath,
          [
            '#!/bin/sh',
            `ELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${tripyoyoCliRunner}" "$@"`,
            '',
          ].join('\n'),
          'utf8',
        );
        chmodSync(shimPath, 0o755);
      }
    }

    // Prepend so the bundled CLI wins over any system-wide install.
    const pathSep = isWindows ? ';' : ':';
    process.env.PATH = `${shimDir}${pathSep}${process.env.PATH}`;
    logger.info(`tripyoyo CLI shim ready, prepended to PATH: ${shimDir}`);
  } catch (error) {
    logger.error('Failed to create tripyoyo CLI shim:', error);
  }
};

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { larkCliBin, larkCliHome, larkCliMasterKeyFile } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:feishuCli');

export interface RunLarkCliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * macOS only: pin lark-cli to its local-file master-key backend by pre-seeding a
 * random 32-byte master key, so it never calls the OS Keychain.
 *
 * lark-cli encrypts its app-secret/tokens with a master key kept in the macOS
 * Keychain by default. We spawn it with an isolated HOME (larkCliHome), where the
 * keychain is unreachable, so the first keychain-touching op (`config init`,
 * `auth login`) makes securityd pop a native "找不到用于储存 master.key 的钥匙串"
 * dialog. lark-cli treats the presence of `master.key.file` as "already
 * downgraded" and reads the key from that file, bypassing the keychain entirely —
 * so writing it up front avoids the dialog. The key is a plain 32 random bytes
 * (its own symmetric key; lark-cli does not validate provenance). Written once
 * with `wx` (no-op if it already exists, e.g. a real login from an older build);
 * a lost race is harmless and ignored.
 */
const ensureLocalMasterKey = (): void => {
  if (process.platform !== 'darwin' || existsSync(larkCliMasterKeyFile)) return;
  try {
    mkdirSync(dirname(larkCliMasterKeyFile), { recursive: true });
    writeFileSync(larkCliMasterKeyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
    logger.debug('Seeded local lark-cli master key (keychain bypass)');
  } catch {
    /* already exists or racing write — fine */
  }
};

/**
 * Run the bundled lark-cli (Feishu CLI) native binary and capture its output.
 * It is a prebuilt Go binary, so it is spawned directly.
 */
export const runLarkCli = (
  args: string[],
  options: { input?: string; timeout?: number } = {},
): Promise<RunLarkCliResult> => {
  const { input, timeout = DEFAULT_TIMEOUT } = options;

  if (!existsSync(larkCliBin)) {
    return Promise.resolve({
      exitCode: -1,
      stderr: `lark-cli binary not found: ${larkCliBin}`,
      stdout: '',
    });
  }

  // Point lark-cli at a desktop-private HOME so its config/login stay isolated
  // from any system-wide lark-cli (matches the skill shim, see ensureLarkCliShim).
  try {
    mkdirSync(larkCliHome, { recursive: true });
  } catch {
    /* ignore */
  }

  // Bypass the OS Keychain before any lark-cli invocation (see fn doc).
  ensureLocalMasterKey();

  return new Promise((resolve) => {
    logger.debug(`Running lark-cli: ${args.join(' ')}`);
    const child = execFile(
      larkCliBin,
      args,
      { env: { ...process.env, HOME: larkCliHome, USERPROFILE: larkCliHome }, timeout },
      (error, stdout, stderr) => {
        // execFile passes a non-null error on non-zero exit / timeout; we still
        // want the captured output and a numeric exit code for the caller.
        const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ exitCode, stderr: stderr ?? '', stdout: stdout ?? '' });
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
};

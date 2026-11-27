import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveAgainstCwd } from '@lobechat/local-file-shell';

export const filePathToAppUrl = (filePath: string) => {
  return `app://calcifer.train.ctripcorp.com${pathToFileURL(filePath).pathname}`;
};

/**
 * The scratch working directory used when the user hasn't set one:
 * `<home>/Desktop/tripyoyoWork`. Sandboxes the agent's generated artifacts so
 * they don't scatter across the home directory or the Electron app launch dir
 * (`process.cwd()`), and keeps them on the Desktop where the user can easily
 * find and clean them up.
 *
 * Matches the prompt placeholder / client+server runtime state fallback chain
 * (`scratchWorkingDirectory` in `src/helpers/agentWorkingDirectory.ts`) so the
 * path the model sees in its prompt is exactly where files land.
 */
const SCRATCH_WORKING_DIRECTORY = path.join(os.homedir(), 'Desktop', 'tripyoyoWork');

/**
 * Resolve a tool's working directory, falling back to `<Desktop>/tripyoyoWork`.
 *
 * `local-file-shell` resolves a relative path against `cwd`, and when `cwd` is
 * empty Node falls back to `process.cwd()` — which in the Electron main
 * process is the app launch dir (e.g. `apps/desktop`), never what the user
 * wants. Every `LocalFileCtr` / `ShellCommandCtr` handler routes its `cwd`
 * through this so an unset working directory lands in `tripyoyoWork` instead
 * of the app dir.
 *
 * When falling back, the scratch dir is created (idempotent) so a follow-up
 * `spawn({ cwd })` (runCommand) or file write doesn't fail on a missing dir.
 *
 * CLIs that call `local-file-shell` directly are intentionally unaffected:
 * their `process.cwd()` is the terminal's cwd, which is the right default
 * for them.
 */
export const resolveCwd = (cwd?: string): string => {
  if (cwd) return cwd;
  mkdirSync(SCRATCH_WORKING_DIRECTORY, { recursive: true });
  return SCRATCH_WORKING_DIRECTORY;
};

/**
 * Resolve a path the same way `local-file-shell`'s file tools do: expand `~`,
 * pass absolute paths through, join relative paths against `cwd` (defaulting
 * to `<Desktop>/tripyoyoWork` via {@link resolveCwd}).
 *
 * Used by `handleOpenLocalFile` / `handleOpenLocalFolder` so that "reveal in
 * Finder" on a tool result opens the same folder the file was actually
 * written to — instead of `process.cwd()` (the app launch dir) when the LLM
 * supplied a relative path.
 */
export const resolvePath = (inputPath?: string, cwd?: string): string | undefined =>
  resolveAgainstCwd(inputPath, cwd ?? resolveCwd());

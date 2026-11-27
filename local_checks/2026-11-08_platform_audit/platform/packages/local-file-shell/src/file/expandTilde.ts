import os from 'node:os';
import path from 'node:path';

/**
 * Expand a leading `~` (or `~/...`, `~\...`) to the user's home directory.
 * Pass-through for any other input — Node fs APIs do not expand `~` the way a
 * shell does, so paths supplied by the LLM (or pasted by users) would otherwise
 * fail with ENOENT. Mirrors the upstream lobehub implementation.
 */
export const expandTilde = (input: string | undefined): string | undefined => {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

export const resolveAgainstCwd = (input: string | undefined, cwd?: string): string | undefined => {
  const expanded = expandTilde(input);
  if (!expanded || !cwd) return expanded;
  return path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded);
};

import { readFile } from 'node:fs/promises';

import { log } from './logger';

/**
 * Parses a CLI option value that may be either an inline JSON string or a
 * path to a JSON file. `--manifest` used to mean "inline JSON" on `plugin
 * install/create/update` but "file path" on `market mcp publish/update` —
 * same flag name, opposite semantics, so callers kept guessing wrong. This
 * accepts both everywhere instead of erroring on whichever form wasn't
 * expected.
 */
export async function parseJsonArg(value: string, label: string): Promise<any> {
  try {
    return JSON.parse(value);
  } catch {
    // Not inline JSON — fall through to try it as a file path.
  }

  try {
    return JSON.parse(await readFile(value, 'utf8'));
  } catch (error) {
    log.error(
      `Invalid ${label}: not valid inline JSON, and could not read/parse it as a file (${(error as Error).message})`,
    );
    process.exit(1);
    // `process.exit` never returns in production; the throw below only guards
    // against test doubles that mock it as a no-op.
    throw new Error(`process.exit(1): invalid ${label}`, { cause: error });
  }
}

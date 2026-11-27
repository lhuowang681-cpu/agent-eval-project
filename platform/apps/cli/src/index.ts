import { spawnSync } from 'node:child_process';

import { createProgram } from './program';
import { log } from './utils/logger';

// Internal ctrip endpoints (server / device gateway / S3 upload targets) use
// certs signed by the corporate CA, which Node's bundled CA list doesn't trust
// by default. `--use-system-ca` makes Node trust the OS keychain instead —
// where corp IT already provisions the CA — without disabling verification for
// every other host. It's a Node startup flag, so it only takes effect on a
// freshly spawned process: re-exec once with it set, guarded by an env var so
// the re-exec'd child doesn't loop. Falls back to the old blanket bypass on
// runtimes that predate the flag (checked on the current process, since that's
// the runtime the re-exec would use too) — e.g. `bun run dev`, or a system
// Node older than the flag's introduction.
if (!process.env.TRIPYOYO_CLI_SYSTEM_CA_PATCHED) {
  process.env.TRIPYOYO_CLI_SYSTEM_CA_PATCHED = '1';

  if (process.allowedNodeEnvironmentFlags.has('--use-system-ca')) {
    const result = spawnSync(process.execPath, ['--use-system-ca', ...process.argv.slice(1)], {
      stdio: 'inherit',
    });
    process.exit(result.status ?? 1);
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';
  }
}

void createProgram()
  .parseAsync(process.argv, { from: 'node' })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    process.exit(1);
  });

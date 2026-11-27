import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dev-mode guard: make sure the bundled tripyoyo CLI (@ctrip/tripyoyo-cli) is built
// before electron-vite starts. Packaged builds get the bundle via electron-builder's
// beforePack; dev builds resolve `tripyoyoCliRunner` to apps/cli/dist/index.js, and
// `ensureTripyoyoCliShim` no-ops when that file is missing — which leaves `lh`
// invocations from execScript with "No such file or directory" on the shim path.
// Running this before `electron-vite dev` guarantees the shim is generated.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.join(__dirname, '..', '..', 'cli');
const entry = path.join(cliDir, 'dist', 'index.js');

console.info(`[tripyoyo-cli] bundle: ${entry}`);

// Skip if already built. We only check existence (not freshness): the CLI source
// rarely changes, and forcing a rebuild on every `dev:desktop` would add seconds to
// each launch. If you edit apps/cli/src/**, run `bun --cwd apps/cli build` yourself.
if (fs.existsSync(entry)) {
  console.info('[tripyoyo-cli] ✅ bundle already built, skipping.');
  process.exit(0);
}

if (!fs.existsSync(path.join(cliDir, 'package.json'))) {
  console.error(`[tripyoyo-cli] ❌ apps/cli not found at ${cliDir}`);
  process.exit(1);
}

console.info('[tripyoyo-cli] ⬇️  building @ctrip/tripyoyo-cli (first run)...');

// Prefer `bun run build` (project convention: bun for npm scripts). Fall back to
// pnpm if bun isn't on PATH — both resolve `tsdown` via the workspace install.
const isWindows = process.platform === 'win32';
try {
  execFileSync('bun', ['run', 'build'], { cwd: cliDir, stdio: 'inherit', shell: isWindows });
} catch {
  try {
    execFileSync('pnpm', ['run', 'build'], { cwd: cliDir, stdio: 'inherit', shell: isWindows });
  } catch (err2) {
    console.error(`[tripyoyo-cli] ❌ build failed: ${err2.message}`);
    console.error('[tripyoyo-cli]    Run `bun --cwd apps/cli build` manually, then retry.');
    process.exit(1);
  }
}

if (!fs.existsSync(entry)) {
  console.error(`[tripyoyo-cli] ❌ build exited 0 but ${entry} is still missing`);
  process.exit(1);
}

console.info('[tripyoyo-cli] ✅ bundle ready.');

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

// Wipe the Electron desktop app's userData directory(ies) to recover a
// first-launch state. We target the dev build by default (the package `name`
// becomes app.getName() in dev), and optionally the packaged builds via --all.
//
//   node apps/desktop/scripts/clean-userdata.mjs              # clean dev userData (confirm prompt)
//   node apps/desktop/scripts/clean-userdata.mjs --yes        # skip confirmation
//   node apps/desktop/scripts/clean-userdata.mjs --cache-only # only delete caches, keep login/settings
//   node apps/desktop/scripts/clean-userdata.mjs --all        # also clean packaged builds (TripYoYo, *-Nightly)

const DEV_APP_NAME = 'tripyoyo-desktop-dev';
const PACKAGED_APP_NAMES = ['TripYoYo', 'TripYoYo-Nightly', 'LobeHub', 'LobeHub-Nightly'];

// Subdirectories that are pure caches — safe to remove without losing login
// state, settings, or lark-cli authorization.
const CACHE_ENTRIES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Service Worker',
];

const args = new Set(process.argv.slice(2));
const cacheOnly = args.has('--cache-only');
const skipConfirm = args.has('--yes') || args.has('-y');
const includePackaged = args.has('--all');

/** Electron userData base dir per platform. */
function userDataBase() {
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32')
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/** Human-readable size of a path (best-effort, via `du`). */
function dirSize(target) {
  try {
    if (process.platform === 'win32') return '';
    const out = execSync(`du -sh ${JSON.stringify(target)}`, { encoding: 'utf8' });
    return out.split('\t')[0].trim();
  } catch {
    return '';
  }
}

/** Whether a running desktop/electron process might be holding these dirs. */
function isAppRunning() {
  try {
    if (process.platform === 'win32') return false; // skip the check on Windows
    const out = execSync('pgrep -fl electron || true', { encoding: 'utf8' });
    return /tripyoyo|electron/i.test(out);
  } catch {
    return false;
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

async function main() {
  const base = userDataBase();
  const appNames = [DEV_APP_NAME, ...(includePackaged ? PACKAGED_APP_NAMES : [])];

  // Resolve which app dirs actually exist on disk.
  const targets = appNames
    .map((name) => ({ name, dir: path.join(base, name) }))
    .filter(({ dir }) => fs.existsSync(dir));

  if (targets.length === 0) {
    console.log('Nothing to clean — no matching userData directories found under:');
    console.log(`  ${base}`);
    return;
  }

  console.log(`Mode: ${cacheOnly ? 'cache-only (keep login/settings)' : 'full wipe'}`);
  console.log('Targets:');
  for (const { name, dir } of targets) {
    const size = dirSize(dir);
    console.log(`  - ${name}${size ? ` (${size})` : ''}`);
  }

  if (isAppRunning()) {
    console.error(
      '\n✗ A desktop/electron process appears to be running. Quit the app first, then retry.',
    );
    process.exit(1);
  }

  if (!skipConfirm) {
    const answer = await ask('\nProceed? This cannot be undone. [y/N] ');
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      console.log('Aborted.');
      return;
    }
  }

  for (const { name, dir } of targets) {
    if (cacheOnly) {
      for (const entry of CACHE_ENTRIES) {
        const p = path.join(dir, entry);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      }
      console.log(`✓ Cleared caches in ${name}`);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`✓ Removed ${name}`);
    }
  }

  console.log('\nDone. The desktop app will rebuild a fresh profile on next launch.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// OpenCLI is an npm package (not a prebuilt binary like agent-browser), so we
// vendor the whole package tree (package + production deps) into resources at
// build time. At runtime the desktop app runs its entry with Electron's built-in
// Node (ELECTRON_RUN_AS_NODE=1), so the user does NOT need Node >= 20 installed.
const VERSION = '1.8.5';
const PACKAGE = '@jackwener/opencli';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vendor into a nested `runtime/` subdir (NOT directly under resources/opencli):
// electron-builder's extraResources copy hard-drops a `node_modules` that sits at
// the copy root, so the tree must live one level deep to survive packaging. The
// const in apps/desktop/src/main/const/dir.ts mirrors this `runtime` segment.
const openCliDir = path.join(__dirname, '..', 'resources', 'opencli', 'runtime');
const versionFile = path.join(openCliDir, '.opencli-version');
const entry = path.join(
  openCliDir,
  'node_modules',
  '@jackwener',
  'opencli',
  'dist',
  'src',
  'main.js',
);
// argv-normalizing shim spawned at runtime (see ensureOpenCliShim in the desktop
// main process). Checked in the skip guard so a missing shim triggers re-install
// rather than silently leaving `opencli` off PATH.
const shimPath = path.join(openCliDir, 'run.cjs');

// Bump when the shim source below changes so old checkouts get their shim
// rewritten even when npm-install would otherwise be skipped.
const SHIM_VERSION = 2;

const shimContent = [
  `// opencli-shim v${SHIM_VERSION}`,
  '// Hide the Electron marker so OpenCLI/commander uses standard Node argv parsing',
  '// (otherwise nested subcommand positionals are mis-parsed under ELECTRON_RUN_AS_NODE).',
  'try { delete process.versions.electron; } catch {}',
  "const path = require('node:path');",
  "const { pathToFileURL } = require('node:url');",
  '// import() takes a URL specifier — on Windows an absolute path like',
  "// 'D:\\\\...\\\\main.js' is rejected as ERR_UNSUPPORTED_ESM_URL_SCHEME because the",
  '// loader parses the drive letter as a protocol. pathToFileURL forces a proper',
  '// file:// URL on every platform.',
  "const entry = path.join(__dirname, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');",
  'import(pathToFileURL(entry).href);',
  '',
].join('\n');

const shimUpToDate = () => {
  if (!fs.existsSync(shimPath)) return false;
  try {
    return fs.readFileSync(shimPath, 'utf8') === shimContent;
  } catch {
    return false;
  }
};

console.info(`[opencli] target dir: ${openCliDir}`);
console.info(`[opencli] requested version: ${VERSION}`);

// Skip if already vendored at the requested version (and the shim is intact).
if (fs.existsSync(versionFile) && fs.existsSync(entry)) {
  const existing = fs.readFileSync(versionFile, 'utf8').trim();
  if (existing === VERSION) {
    if (shimUpToDate()) {
      console.info(`[opencli] ✅ v${VERSION} already vendored, skipping.`);
      process.exit(0);
    }
    // Package tree is fine; only the shim is stale (or missing). Rewrite it in
    // place — reinstalling npm just to refresh a 12-line launcher is wasteful.
    console.info(`[opencli] refreshing shim (v${SHIM_VERSION})...`);
    fs.writeFileSync(shimPath, shimContent, 'utf8');
    console.info(`[opencli] ✅ v${VERSION} already vendored, shim refreshed.`);
    process.exit(0);
  }
  console.info(`[opencli] version changed (${existing} → ${VERSION}), re-installing.`);
}

await mkdir(openCliDir, { recursive: true });

// A minimal package.json keeps npm from walking up to the monorepo root.
const pkgManifest = path.join(openCliDir, 'package.json');
if (!fs.existsSync(pkgManifest)) {
  await writeFile(
    pkgManifest,
    JSON.stringify({ name: 'opencli-vendor', private: true, version: '0.0.0' }, null, 2),
    'utf8',
  );
}

console.info(`[opencli] ⬇️  installing ${PACKAGE}@${VERSION} ...`);

try {
  // Spawn npm directly on Unix so argv (including openCliDir with embedded
  // spaces) is passed as discrete tokens — shell:true would concatenate args
  // without quoting and break --prefix on paths containing spaces. On Windows
  // npm is a .cmd shim that CreateProcess cannot execute directly, so shell:true
  // is required there to let cmd.exe resolve npm → npm.cmd (this is the Windows
  // MCD ENOENT fix from f8602f1e; Windows paths with spaces remain an accepted
  // edge case, rare for project checkout paths).
  execFileSync(
    'npm',
    [
      'install',
      `${PACKAGE}@${VERSION}`,
      '--prefix',
      openCliDir,
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--no-save',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (!fs.existsSync(entry)) {
    throw new Error(`entry not found after install: ${entry}`);
  }

  // OpenCLI uses commander, which auto-detects Electron via process.versions.electron.
  // That flag is still set under ELECTRON_RUN_AS_NODE, so commander parses argv in
  // "electron" mode at BOTH the top level and inside nested subcommands (e.g. the
  // `browser <session> <command>` positionals), mis-reading the session as a command.
  // Deleting the marker makes commander use standard Node argv semantics throughout.
  // Resolve the entry relative to the shim so it works in dev and packaged.
  await writeFile(shimPath, shimContent, 'utf8');

  await writeFile(versionFile, VERSION, 'utf8');
  console.info(`[opencli] ✅ v${VERSION} ready, entry: ${entry}`);
} catch (err) {
  console.error(`[opencli] ❌ install failed: ${err.message}`);
  process.exit(1);
}

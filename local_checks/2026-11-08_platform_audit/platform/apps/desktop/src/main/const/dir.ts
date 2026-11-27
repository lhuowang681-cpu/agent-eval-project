import { join } from 'node:path';

import { app } from 'electron';

export const mainDir = join(__dirname);

export const preloadDir = join(mainDir, '../preload');

export const resourcesDir = join(mainDir, '../../resources');

export const buildDir = join(mainDir, '../../build');

export const binDir = app.isPackaged
  ? join(process.resourcesPath, 'bin')
  : join(resourcesDir, 'bin');

// The bundled lark-cli (Feishu CLI) native binary lives in binDir (downloaded by
// scripts/download-lark-cli.mjs). binDir is on PATH for skill execScript; the
// main-process controller spawns it by absolute path.
export const larkCliBin = join(binDir, process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli');

// A desktop-private HOME for lark-cli so its config (`$HOME/.lark-cli/`) and the
// app it is bound to are isolated from any system-wide lark-cli the user runs in
// their own terminal. Both the skill shim and the controller point lark-cli's
// HOME here so they share one isolated config/login.
export const larkCliHome = join(app.getPath('userData'), 'lark-cli-home');

// Where lark-cli reads its master key from once "downgraded" off the OS keychain.
// On macOS lark-cli encrypts its app-secret/tokens with a 32-byte master key that
// it stores in the system Keychain by default. Because we run it with an isolated
// HOME (larkCliHome), the keychain is unreachable and securityd pops a native
// "找不到用于储存 master.key 的钥匙串" dialog. Pre-seeding this raw 32-byte key
// file makes lark-cli use the local-file backend and never touch the keychain.
// Path mirrors lark-cli's own layout: `$HOME/Library/Application Support/lark-cli/`.
export const larkCliMasterKeyFile = join(
  larkCliHome,
  'Library',
  'Application Support',
  'lark-cli',
  'master.key.file',
);

// OpenCLI is vendored as an npm package tree (see scripts/install-opencli.mjs),
// placed under resources/opencli/runtime. The `runtime/` nesting is required:
// electron-builder's extraResources copy does not drop the root `node_modules`
// (it hard-excludes a node_modules that is a direct child of the copy root).
// Must stay in sync with scripts/install-opencli.mjs.
export const openCliDir = app.isPackaged
  ? join(process.resourcesPath, 'opencli', 'runtime')
  : join(resourcesDir, 'opencli', 'runtime');

export const openCliEntry = join(
  openCliDir,
  'node_modules',
  '@jackwener',
  'opencli',
  'dist',
  'src',
  'main.js',
);

// argv-normalizing shim spawned at runtime (see scripts/install-opencli.mjs).
export const openCliRunner = join(openCliDir, 'run.cjs');

// The bundled tripyoyo CLI (@ctrip/tripyoyo-cli) is a single-file JS bundle run
// through Electron's built-in Node (ELECTRON_RUN_AS_NODE), so — like OpenCLI and
// unlike the native lark-cli binary — it needs a generated launcher rather than a
// raw executable in binDir. Packaged: copied to resources/bin/tripyoyo-cli.js by
// electron-builder.mjs's beforePack. Dev: apps/cli/dist/index.js (run `bun --cwd
// apps/cli build` first, or the shim/detector are no-ops). The bundle's pkg.ts
// resolves `../package.json`; packaged that maps to resources/package.json (see
// the cli-package.json extraResources entry), in dev to apps/cli/package.json.
export const tripyoyoCliRunner = app.isPackaged
  ? join(binDir, 'tripyoyo-cli.js')
  : join(app.getAppPath(), '..', 'cli', 'dist', 'index.js');

// Writable dir where the tripyoyo CLI launchers (`tripyoyo`/`lh`/`yoyo`) are
// generated each launch (see ensureTripyoyoCliShim). Shared with CliCtr, which
// invokes the `tripyoyo` launcher by absolute path to inject auth env.
export const tripyoyoCliShimDir = join(app.getPath('userData'), 'tripyoyo-bin');

const appPath = app.getAppPath();

export const rendererDir = join(appPath, 'dist', 'renderer');

export const userDataDir = app.getPath('userData');

export const appStorageDir = join(userDataDir, 'lobehub-storage');

// Legacy local database directory used in older desktop versions
export const legacyLocalDbDir = join(appStorageDir, 'lobehub-local-db');

// ------  Application storage directory ---- //

// Local storage files (simulating S3)
export const FILE_STORAGE_DIR = 'file-storage';
// Plugin installation directory
export const INSTALL_PLUGINS_DIR = 'plugins';

// Desktop file service
export const LOCAL_STORAGE_URL_PREFIX = '/lobe-desktop-file';

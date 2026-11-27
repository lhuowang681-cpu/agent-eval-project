#!/usr/bin/env node
/**
 * Offline mock provisioning for the desktop app's external binaries.
 *
 * `apps/desktop`'s dev script normally shells out to two downloaders before Electron starts:
 *
 *   scripts/install-opencli.mjs   → npm-installs @jackwener/opencli and vendors the tree
 *   scripts/download-lark-cli.mjs → downloads the lark-cli binary from GitHub / npmmirror
 *
 * Both reach the network. This script fabricates the exact file layout they would have
 * produced, using local stubs, so `bun run dev:desktop` starts with zero egress.
 *
 * The stubs are deliberately LOUD: invoking them prints a `[stub]` banner and exits non-zero,
 * so a test that actually depends on these CLIs fails visibly instead of silently passing.
 *
 * Usage:  node scripts/local/setupOfflineMocks.mjs
 *         node scripts/local/setupOfflineMocks.mjs --clean
 *
 * See PLAN.md §4.3 / stubs/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const desktopResources = path.join(repoRoot, 'apps', 'desktop', 'resources');

// Versions must match the real downloader scripts so their skip-guards short-circuit.
const OPENCLI_VERSION = '1.8.5';
const LARK_CLI_VERSION = '1.0.64';

const clean = process.argv.includes('--clean');

const write = (filePath, content, mode) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  if (mode) fs.chmodSync(filePath, mode);
  console.info(`  ✓ ${path.relative(repoRoot, filePath)}`);
};

const banner = (name) =>
  `[stub] ${name} is a local offline placeholder — the real binary was never downloaded.\\n` +
  `[stub] See scripts/local/setupOfflineMocks.mjs. Nothing that depends on ${name} can pass offline.`;

// ── OpenCLI ─────────────────────────────────────────────────────────────────
// Real layout (scripts/install-opencli.mjs):
//   resources/opencli/runtime/.opencli-version
//   resources/opencli/runtime/package.json
//   resources/opencli/runtime/run.cjs
//   resources/opencli/runtime/node_modules/@jackwener/opencli/dist/src/main.js

const setupOpenCli = () => {
  const runtimeDir = path.join(desktopResources, 'opencli', 'runtime');

  if (clean) {
    fs.rmSync(path.join(desktopResources, 'opencli'), { force: true, recursive: true });
    console.info('  ✓ removed resources/opencli');
    return;
  }

  console.info('[offline-mocks] OpenCLI');

  write(path.join(runtimeDir, '.opencli-version'), OPENCLI_VERSION);

  write(
    path.join(runtimeDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'opencli-runtime-stub',
        private: true,
        version: OPENCLI_VERSION,
      },
      null,
      2,
    )}\n`,
  );

  const mainJs = path.join(
    runtimeDir,
    'node_modules',
    '@jackwener',
    'opencli',
    'dist',
    'src',
    'main.js',
  );

  write(
    mainJs,
    [
      '#!/usr/bin/env node',
      '// Offline stub for @jackwener/opencli — see scripts/local/setupOfflineMocks.mjs',
      `console.error(\`${banner('opencli')}\`);`,
      "if (process.argv.includes('--version')) { console.log('" + OPENCLI_VERSION + "-stub'); process.exit(0); }",
      'process.exit(1);',
      '',
    ].join('\n'),
  );

  // Mirrors the launcher the real script generates.
  write(
    path.join(runtimeDir, 'run.cjs'),
    [
      "const path = require('node:path');",
      "const entry = path.join(__dirname, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');",
      'process.argv.splice(1, 1, entry);',
      'require(entry);',
      '',
    ].join('\n'),
  );
};

// ── lark-cli ────────────────────────────────────────────────────────────────
// Real layout (scripts/download-lark-cli.mjs):
//   resources/bin/.lark-cli-version
//   resources/bin/lark-cli        (or lark-cli.exe on win32)

const setupLarkCli = () => {
  const binDir = path.join(desktopResources, 'bin');
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'lark-cli.exe' : 'lark-cli';

  if (clean) {
    for (const f of ['.lark-cli-version', 'lark-cli', 'lark-cli.exe', 'lark-cli.cmd']) {
      fs.rmSync(path.join(binDir, f), { force: true });
    }
    console.info('  ✓ removed resources/bin/lark-cli*');
    return;
  }

  console.info('[offline-mocks] lark-cli');

  write(path.join(binDir, '.lark-cli-version'), LARK_CLI_VERSION);

  if (isWin) {
    // Windows cannot fabricate a real PE executable, so we do two things:
    //  - lark-cli.cmd  : a working shim that PATH lookup (via PATHEXT) will find
    //  - lark-cli.exe  : a placeholder so `existsSync(larkCliBin)` checks pass.
    //                    Spawning it fails — which is the intended loud failure.
    write(
      path.join(binDir, 'lark-cli.cmd'),
      ['@echo off', `echo ${banner('lark-cli').replaceAll('\\n', '')} 1>&2`, 'exit /b 1', ''].join(
        '\r\n',
      ),
    );
    write(
      path.join(binDir, binName),
      `${banner('lark-cli')}\nThis is NOT a real executable — it exists only so path checks succeed.\n`,
    );
  } else {
    write(
      path.join(binDir, binName),
      ['#!/bin/sh', `echo "${banner('lark-cli')}" 1>&2`, 'exit 1', ''].join('\n'),
      0o755,
    );
  }
};

// ── main ────────────────────────────────────────────────────────────────────

console.info(
  clean
    ? '[offline-mocks] cleaning fabricated desktop binaries…'
    : '[offline-mocks] provisioning desktop binaries without network…',
);

setupOpenCli();
setupLarkCli();

console.info(
  clean
    ? '[offline-mocks] done.'
    : '[offline-mocks] done. `bun run dev:desktop` will now skip both downloaders.',
);

import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';
import { hasRuntimeForCurrentPlatform } from '@/modules/portableRuntime/manifest';
import { readRuntimeMeta } from '@/modules/portableRuntime/meta';
import { getRuntimeBinDir, getRuntimeExecutable } from '@/modules/portableRuntime/paths';
import type { RuntimeName } from '@/modules/portableRuntime/types';

const execFileP = promisify(execFile);
const execP = promisify(exec);

async function readVersion(exePath: string): Promise<string | undefined> {
  const isCmdShim = platform() === 'win32' && /\.(?:cmd|bat)$/i.test(exePath);
  try {
    const { stderr, stdout } = isCmdShim
      ? await execP(`"${exePath}" --version`, {
          timeout: 3000,
          windowsHide: true,
        })
      : await execFileP(exePath, ['--version'], {
          timeout: 3000,
          windowsHide: true,
        });
    return `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0];
  } catch {
    return;
  }
}

async function detectManagedRuntime(name: RuntimeName): Promise<ToolStatus | undefined> {
  const meta = await readRuntimeMeta(name);
  if (!meta) return;
  const exe = getRuntimeExecutable(name);
  try {
    await fs.access(exe);
  } catch {
    return;
  }
  const version = await readVersion(exe);
  if (!version) return;
  return {
    available: true,
    installedVersion: meta.version,
    managedBy: 'app',
    path: exe,
    version,
  };
}

const withSystemTag = (status: ToolStatus): ToolStatus =>
  status.available ? { ...status, managedBy: 'system' } : status;

const withPortableSupport = (status: ToolStatus, runtime: RuntimeName): ToolStatus => ({
  ...status,
  supportedOnCurrentPlatform: hasRuntimeForCurrentPlatform(runtime),
});

/**
 * Reusable factory for tools that support both portable install and system fallback.
 * Managed-first: reads .calcifer-meta.json, then falls back to createCommandDetector.
 */
export function createPortableFirstDetector(
  runtime: RuntimeName,
  systemCommand: string,
  options: { description?: string; priority?: number } = {},
): IToolDetector {
  return {
    description: options.description,
    async detect() {
      const managed = await detectManagedRuntime(runtime);
      if (managed) return withPortableSupport(managed, runtime);
      const fallback = withSystemTag(await createCommandDetector(systemCommand).detect());
      return withPortableSupport(fallback, runtime);
    },
    name: runtime,
    priority: options.priority,
  };
}

async function detectManagedNpm(): Promise<ToolStatus | undefined> {
  const meta = await readRuntimeMeta('node');
  if (!meta) return;
  const binDir = getRuntimeBinDir('node');
  const npmPath = platform() === 'win32' ? `${binDir}\\npm.cmd` : `${binDir}/npm`;
  try {
    await fs.access(npmPath);
  } catch {
    return;
  }
  const version = await readVersion(npmPath);
  if (!version) return;
  return {
    available: true,
    installedVersion: meta.version,
    managedBy: 'app',
    path: npmPath,
    version,
  };
}

/**
 * Detect a package installed into the portable Node's global prefix
 * (e.g. `runtimes/node/bin/pnpm` after `npm i -g pnpm`).
 *
 * Returns undefined when portable node is not managed, or when the shim
 * for the package isn't present in node's bin dir.
 */
async function detectManagedNpmGlobal(
  packageName: string,
  binName: string,
): Promise<ToolStatus | undefined> {
  const meta = await readRuntimeMeta('node');
  if (!meta) return;
  const binDir = getRuntimeBinDir('node');
  const shim = platform() === 'win32' ? `${binDir}\\${binName}.cmd` : `${binDir}/${binName}`;
  try {
    await fs.access(shim);
  } catch {
    return;
  }
  const version = await readVersion(shim);
  if (!version) return;
  return {
    available: true,
    // Report the package's own version, not node's.
    installedVersion: version.replace(/^v/, ''),
    managedBy: 'app',
    path: shim,
    version,
  };
}

/**
 * Node.js runtime detector — prefers app-managed portable runtime.
 */
export const nodeDetector: IToolDetector = {
  description: 'Node.js - JavaScript runtime',
  async detect() {
    const managed = await detectManagedRuntime('node');
    if (managed) return withPortableSupport(managed, 'node');
    const fallback = withSystemTag(await createCommandDetector('node').detect());
    return withPortableSupport(fallback, 'node');
  },
  name: 'node',
  priority: 1,
};

/**
 * NPM package manager detector — prefers app-managed portable node's bundled npm.
 */
export const npmDetector: IToolDetector = {
  description: 'npm - Node.js package manager',
  async detect() {
    const managed = await detectManagedNpm();
    if (managed) return withPortableSupport(managed, 'node');
    const fallback = withSystemTag(await createCommandDetector('npm').detect());
    return withPortableSupport(fallback, 'node');
  },
  name: 'npm',
  priority: 2,
};

/**
 * Python runtime detector — prefers app-managed portable runtime, then system.
 */
export const pythonDetector: IToolDetector = {
  description: 'Python - programming language runtime',
  async detect(): Promise<ToolStatus> {
    const managed = await detectManagedRuntime('python');
    if (managed) return withPortableSupport(managed, 'python');

    const commands = platform() === 'win32' ? ['python', 'py'] : ['python3', 'python'];
    for (const cmd of commands) {
      const status = await createCommandDetector(cmd).detect();
      if (status.available && status.version) {
        return withPortableSupport({ ...status, managedBy: 'system' }, 'python');
      }
    }
    return withPortableSupport({ available: false }, 'python');
  },
  name: 'python',
  priority: 3,
};

/**
 * Bun runtime detector — portable-first, then system fallback.
 */
export const bunDetector: IToolDetector = createPortableFirstDetector('bun', 'bun', {
  description: 'Bun - fast JavaScript runtime and package manager',
  priority: 4,
});

/**
 * Bunx package runner detector — shares the bun binary (managed) or falls back to system bunx.
 */
export const bunxDetector: IToolDetector = {
  description: 'bunx - Bun package runner for executing npm packages',
  async detect() {
    const managed = await detectManagedRuntime('bun');
    if (managed) {
      // bunx is bun invoked under a different argv[0]; expose the same binary path.
      return withPortableSupport({ ...managed, path: managed.path }, 'bun');
    }
    const fallback = withSystemTag(await createCommandDetector('bunx').detect());
    return withPortableSupport(fallback, 'bun');
  },
  name: 'bunx',
  priority: 5,
};

/**
 * pnpm package manager detector — installed into portable node's global
 * prefix via `npm i -g pnpm`, or falls back to system pnpm.
 *
 * pnpm 走 `npm i -g`,只要 node 便携版覆盖当前平台即支持。
 */
export const pnpmDetector: IToolDetector = {
  description: 'pnpm - fast, disk space efficient package manager',
  async detect() {
    const managed = await detectManagedNpmGlobal('pnpm', 'pnpm');
    if (managed) return withPortableSupport(managed, 'node');
    const fallback = withSystemTag(await createCommandDetector('pnpm').detect());
    return withPortableSupport(fallback, 'node');
  },
  name: 'pnpm',
  priority: 6,
};

/**
 * uv Python package manager detector — portable-first.
 */
export const uvDetector: IToolDetector = createPortableFirstDetector('uv', 'uv', {
  description: 'uv - extremely fast Python package manager',
  priority: 7,
});

/**
 * tripyoyo CLI detector.
 *
 * The CLI is app-managed: `ensureTripyoyoCliShim` generates `tripyoyo`/`lh`/`yoyo`
 * launchers into userData and prepends them to PATH on launch. We resolve via
 * PATH (`which`/`where`), validate it is really the tripyoyo CLI by checking that
 * `--help` mentions "TripYoYo" (guards against unrelated `lh`/`yoyo` binaries),
 * then read `--version`. Reported as `managedBy: 'app'` since it ships with the app.
 */
export const tripyoyoCliDetector: IToolDetector = {
  description: 'TripYoYo CLI - manage and connect to TripYoYo services',
  async detect(): Promise<ToolStatus> {
    const commands = ['tripyoyo', 'lh', 'yoyo'];
    const whichCmd = platform() === 'win32' ? 'where' : 'which';

    for (const cmd of commands) {
      try {
        const { stdout: pathOut } = await execP(`${whichCmd} ${cmd}`, { timeout: 3000 });
        const toolPath = pathOut.trim().split(/\r?\n/)[0];
        if (!toolPath) continue;

        const { stdout: helpOut } = await execP(`"${toolPath}" --help`, { timeout: 3000 });
        if (!helpOut.includes('TripYoYo')) continue;

        const version = await readVersion(toolPath);
        return { available: true, managedBy: 'app', path: toolPath, version };
      } catch {
        continue;
      }
    }

    return { available: false };
  },
  name: 'tripyoyo',
  priority: 0,
};

/**
 * All runtime environment detectors
 */
export const runtimeEnvironmentDetectors: IToolDetector[] = [
  tripyoyoCliDetector,
  nodeDetector,
  npmDetector,
  pythonDetector,
  bunDetector,
  bunxDetector,
  pnpmDetector,
  uvDetector,
];

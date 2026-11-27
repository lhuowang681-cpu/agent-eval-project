import path from 'node:path';

import type {
  RuntimeInstallResult,
  RuntimeName,
  RuntimeUninstallResult,
  ToolInstallResult,
} from '@lobechat/electron-client-ipc';
import { execa } from 'execa';

import { getPortableRuntimeManager } from '@/modules/portableRuntime';
import { buildRuntimeEnvSyncFromDisk } from '@/modules/portableRuntime/env';
import { readRuntimeMeta } from '@/modules/portableRuntime/meta';
import { getRuntimeBinDir } from '@/modules/portableRuntime/paths';

interface InstallCommand {
  args: string[];
  bin: string;
  label: string;
}

const RUN_OPTIONS = {
  timeout: 10 * 60 * 1000,
  windowsHide: true,
};

const unsupported = (toolName: string): ToolInstallResult => ({
  error: '当前平台不支持一键安装或此工具为系统内置',
  success: false,
  toolName,
});

const unsupportedUnknown = (toolName: string): ToolInstallResult => ({
  error: `Unsupported tool: ${toolName}`,
  success: false,
  toolName,
});

const prerequisiteMissing = (toolName: string, dependency: string): ToolInstallResult => ({
  error: `缺少 ${dependency}，请先安装后重试`,
  success: false,
  toolName,
});

const getInstallCommand = (toolName: string): InstallCommand | 'unsupported' | undefined => {
  const normalizedToolName = toolName;

  if (['mdfind', 'find', 'grep'].includes(normalizedToolName)) return 'unsupported';

  // 目前所有其它工具都由便携 runtime 或 npm 全局安装接管;
  // 没有需要走 brew / winget 兜底的场景。
  return;
};

const ensureAvailable = async (bin: string): Promise<boolean> => {
  try {
    await execa(bin, ['--version'], {
      ...RUN_OPTIONS,
      env: buildRuntimeEnvSyncFromDisk(process.env),
    });
    return true;
  } catch {
    return false;
  }
};

const runInstallCommand = async (
  toolName: string,
  command: InstallCommand,
): Promise<ToolInstallResult> => {
  try {
    const result = await execa(command.bin, command.args, {
      ...RUN_OPTIONS,
      env: buildRuntimeEnvSyncFromDisk(process.env),
    });
    return {
      commandLabel: command.label,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
      success: true,
      toolName,
    };
  } catch (error) {
    const failed = error as {
      exitCode?: number;
      message?: string;
      stderr?: string;
      stdout?: string;
    };

    return {
      commandLabel: command.label,
      error: failed.stderr || failed.message || '安装失败',
      exitCode: failed.exitCode,
      stderr: failed.stderr,
      stdout: failed.stdout,
      success: false,
      toolName,
    };
  }
};

const PORTABLE_RUNTIMES: RuntimeName[] = ['node', 'python', 'bun', 'uv', 'rg', 'fd'];

const isPortableRuntime = (toolName: string): toolName is RuntimeName =>
  (PORTABLE_RUNTIMES as string[]).includes(toolName);

/** Aliases that route to another portable runtime rather than being a runtime themselves. */
const PORTABLE_ALIASES: Record<string, RuntimeName> = {
  bunx: 'bun',
  npm: 'node',
};

const resolvePortableTarget = (toolName: string): RuntimeName | undefined => {
  if (isPortableRuntime(toolName)) return toolName;
  return PORTABLE_ALIASES[toolName];
};

const runtimeInstallToToolResult = (
  toolName: string,
  result: RuntimeInstallResult,
): ToolInstallResult => {
  if (result.success) {
    return {
      commandLabel: `portable-runtime install ${toolName}`,
      exitCode: 0,
      stderr: '',
      stdout: result.skipped
        ? `${toolName} ${result.version ?? ''} already installed`
        : `${toolName} ${result.version ?? ''} installed`,
      success: true,
      toolName,
    };
  }
  return {
    commandLabel: `portable-runtime install ${toolName}`,
    error: result.error ?? '安装失败',
    exitCode: 1,
    success: false,
    toolName,
  };
};

const runtimeUninstallToToolResult = (
  toolName: string,
  result: RuntimeUninstallResult,
): ToolInstallResult => {
  if (result.success) {
    return {
      commandLabel: `portable-runtime uninstall ${toolName}`,
      exitCode: 0,
      stderr: '',
      stdout: result.alreadyGone ? `${toolName} was not installed` : `${toolName} uninstalled`,
      success: true,
      toolName,
    };
  }
  return {
    commandLabel: `portable-runtime uninstall ${toolName}`,
    error: result.error ?? '卸载失败',
    exitCode: 1,
    success: false,
    toolName,
  };
};

/**
 * Path to the portable node's npm shim, or undefined if portable node isn't
 * installed yet. Used to route `npm i -g <pkg>` installs through the
 * app-managed node instead of any system node.
 */
const getPortableNpmPath = async (): Promise<string | undefined> => {
  const meta = await readRuntimeMeta('node');
  if (!meta) return;
  const binDir = getRuntimeBinDir('node');
  return process.platform === 'win32' ? path.join(binDir, 'npm.cmd') : path.join(binDir, 'npm');
};

/**
 * Ensure portable node is installed, then return the npm shim path. Used by
 * npm-global installs (pnpm) which need node present before they can proceed.
 */
const ensurePortableNpm = async (): Promise<
  { npmPath: string } | { error: string; success: false }
> => {
  let npmPath = await getPortableNpmPath();
  if (npmPath) return { npmPath };
  const mgr = getPortableRuntimeManager();
  const nodeResult = await mgr.install('node');
  if (!nodeResult.success) {
    return {
      error: nodeResult.error ?? '安装 Node.js 失败，无法继续安装 pnpm',
      success: false,
    };
  }
  npmPath = await getPortableNpmPath();
  if (!npmPath) {
    return { error: '安装 Node.js 后仍找不到 npm', success: false };
  }
  return { npmPath };
};

const runNpmGlobal = async (
  toolName: string,
  packageName: string,
  action: 'install' | 'uninstall',
): Promise<ToolInstallResult> => {
  const ensured = await ensurePortableNpm();
  if ('error' in ensured) {
    return { error: ensured.error, exitCode: 1, success: false, toolName };
  }
  const subcommand = action === 'install' ? 'install' : 'uninstall';
  const args = [subcommand, '-g', packageName];
  const commandLabel = `npm ${args.join(' ')}`;
  try {
    const result = await execa(ensured.npmPath, args, {
      ...RUN_OPTIONS,
      env: buildRuntimeEnvSyncFromDisk(process.env),
    });
    return {
      commandLabel,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
      success: true,
      toolName,
    };
  } catch (error) {
    const failed = error as {
      exitCode?: number;
      message?: string;
      stderr?: string;
      stdout?: string;
    };
    return {
      commandLabel,
      error: failed.stderr || failed.message || (action === 'install' ? '安装失败' : '卸载失败'),
      exitCode: failed.exitCode,
      stderr: failed.stderr,
      stdout: failed.stdout,
      success: false,
      toolName,
    };
  }
};

/** Tools installed as npm globals under the portable Node runtime. */
const NPM_GLOBAL_PACKAGES: Record<string, string> = {
  pnpm: 'pnpm',
};

const isNpmGlobalTool = (toolName: string): boolean => toolName in NPM_GLOBAL_PACKAGES;

export const installTool = async (toolName: string): Promise<ToolInstallResult> => {
  const portableTarget = resolvePortableTarget(toolName);
  if (portableTarget) {
    const mgr = getPortableRuntimeManager();
    const result = await mgr.install(portableTarget);
    return runtimeInstallToToolResult(toolName, { ...result, toolName: portableTarget });
  }

  if (isNpmGlobalTool(toolName)) {
    return runNpmGlobal(toolName, NPM_GLOBAL_PACKAGES[toolName], 'install');
  }

  const command = getInstallCommand(toolName);

  if (!command) return unsupportedUnknown(toolName);
  if (command === 'unsupported') return unsupported(toolName);

  if (command.bin === 'brew' && !(await ensureAvailable('brew'))) {
    return prerequisiteMissing(toolName, 'Homebrew');
  }

  if (command.bin === 'winget' && !(await ensureAvailable('winget'))) {
    return prerequisiteMissing(toolName, 'winget');
  }

  return runInstallCommand(toolName, command);
};

export const reinstallTool = async (toolName: string): Promise<ToolInstallResult> => {
  const portableTarget = resolvePortableTarget(toolName);
  if (portableTarget) {
    const mgr = getPortableRuntimeManager();
    const result = await mgr.reinstall(portableTarget);
    return runtimeInstallToToolResult(toolName, { ...result, toolName: portableTarget });
  }
  if (isNpmGlobalTool(toolName)) {
    return runNpmGlobal(toolName, NPM_GLOBAL_PACKAGES[toolName], 'install');
  }
  return installTool(toolName);
};

export const uninstallTool = async (toolName: string): Promise<ToolInstallResult> => {
  const portableTarget = resolvePortableTarget(toolName);
  if (portableTarget) {
    const mgr = getPortableRuntimeManager();
    const result = await mgr.uninstall(portableTarget);
    return runtimeUninstallToToolResult(toolName, { ...result, toolName: portableTarget });
  }
  if (isNpmGlobalTool(toolName)) {
    return runNpmGlobal(toolName, NPM_GLOBAL_PACKAGES[toolName], 'uninstall');
  }
  return {
    commandLabel: `uninstall ${toolName}`,
    error: '当前平台不支持一键卸载该工具',
    exitCode: 1,
    success: false,
    toolName,
  };
};

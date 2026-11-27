import { exec, execFile } from 'node:child_process';
import { platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);
const logger = createLogger('core:ToolDetectorManager');

/**
 * Tool detection status
 */
export interface ToolStatus {
  available: boolean;
  error?: string;
  installedVersion?: string;
  lastChecked?: Date;
  managedBy?: 'app' | 'system';
  path?: string;
  resolvedPathEnv?: string;
  /**
   * 当前平台是否有便携安装源。false 表示 UI 应置灰安装按钮。
   * 省略时视为 true(系统内置工具或与平台无关的项)。
   */
  supportedOnCurrentPlatform?: boolean;
  version?: string;
}

/**
 * Tool detector interface - modules implement this to register detection logic
 */
export interface IToolDetector {
  /** Description */
  description?: string;
  /** Detection method */
  detect: () => Promise<ToolStatus>;
  /** Tool name, e.g., 'rg', 'mdfind' */
  name: string;
  /** Priority within category, lower number = higher priority */
  priority?: number;
}

/**
 * Tool categories
 */
export type ToolCategory =
  | 'content-search'
  | 'ast-search'
  | 'file-search'
  | 'runtime-environment'
  | 'system'
  | 'custom';

interface ResolvedCommand {
  env?: NodeJS.ProcessEnv;
  path: string;
}

const isWindows = () => platform() === 'win32';
let shellPathPromise: Promise<string | undefined> | undefined;

const WINDOWS_RUNNABLE_EXTS = ['.exe', '.cmd', '.bat'] as const;

const pickWindowsRunnable = (lines: string[]): string | undefined => {
  for (const ext of WINDOWS_RUNNABLE_EXTS) {
    const match = lines.find((line) => line.toLowerCase().endsWith(ext));
    if (match) return match;
  }
  return;
};

const getLoginShellPath = async (): Promise<string | undefined> => {
  if (isWindows()) return;

  const shell = process.env.SHELL;
  if (!shell || !path.isAbsolute(shell)) return;

  try {
    const { stdout } = await execFilePromise(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      timeout: 3000,
      windowsHide: true,
    });

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.includes(path.delimiter));
  } catch {
    return;
  }
};

const getCachedLoginShellPath = async (): Promise<string | undefined> => {
  shellPathPromise ??= getLoginShellPath();
  return shellPathPromise;
};

const mergePathValues = (...values: Array<string | undefined>): string | undefined => {
  const seen = new Set<string>();
  const segments = values
    .flatMap((value) => value?.split(path.delimiter) ?? [])
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (!segment || seen.has(segment)) return false;
      seen.add(segment);
      return true;
    });

  return segments.length > 0 ? segments.join(path.delimiter) : undefined;
};

const getCommandPathLines = async (
  whichCommand: 'where' | 'which',
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<string[] | undefined> => {
  try {
    const { stdout } = await execFilePromise(whichCommand, [command], {
      env,
      timeout: 3000,
      windowsHide: true,
    });
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.length > 0 ? lines : undefined;
  } catch {
    return;
  }
};

const resolveCommandPath = async (command: string): Promise<ResolvedCommand | undefined> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return;

  if (path.isAbsolute(trimmedCommand) || trimmedCommand.includes(path.sep)) {
    return { path: trimmedCommand };
  }

  const whichCommand = isWindows() ? 'where' : 'which';
  let lines = await getCommandPathLines(whichCommand, trimmedCommand);
  let lookupEnv: NodeJS.ProcessEnv | undefined;

  if (!lines && !isWindows()) {
    const shellPath = await getCachedLoginShellPath();
    const lookupPath = mergePathValues(shellPath, process.env.PATH);

    if (lookupPath && lookupPath !== process.env.PATH) {
      const fallbackEnv = {
        ...process.env,
        PATH: lookupPath,
      };
      lines = await getCommandPathLines(whichCommand, trimmedCommand, fallbackEnv);
      if (lines) lookupEnv = fallbackEnv;
    }
  }

  if (!lines) return;

  if (isWindows()) {
    const runnablePath = pickWindowsRunnable(lines);
    return runnablePath ? { path: runnablePath } : undefined;
  }

  return { env: lookupEnv, path: lines[0] };
};

/**
 * Tool Detector Manager
 *
 * A plugin-style manager for detecting system tools availability.
 * Modules can register their own detectors and query tool status.
 *
 * @example
 * ```typescript
 * // Register a detector
 * manager.register({
 *   name: 'rg',
 *   description: 'ripgrep',
 *   priority: 1,
 *   async detect() { ... }
 * }, 'content-search');
 *
 * // Query status
 * const status = await manager.detect('rg');
 * const bestTool = await manager.getBestTool('content-search');
 * ```
 */
export class ToolDetectorManager {
  private app: App;
  private detectors = new Map<string, IToolDetector>();
  private statusCache = new Map<string, ToolStatus>();
  private categoryMap = new Map<ToolCategory, Set<string>>();
  private initialized = false;

  constructor(app: App) {
    logger.debug('Initializing ToolDetectorManager');
    this.app = app;
  }

  /**
   * Register a tool detector
   * @param detector The detector to register
   * @param category Tool category for grouping
   */
  register(detector: IToolDetector, category: ToolCategory = 'custom'): void {
    const { name } = detector;

    if (this.detectors.has(name)) {
      logger.warn(`Detector for '${name}' already registered, overwriting`);
    }

    this.detectors.set(name, detector);

    // Add to category
    if (!this.categoryMap.has(category)) {
      this.categoryMap.set(category, new Set());
    }
    this.categoryMap.get(category)!.add(name);

    logger.debug(
      `Registered detector: ${name} (category: ${category}, priority: ${detector.priority ?? 'default'})`,
    );
  }

  /**
   * Unregister a tool detector
   * @param name Tool name to unregister
   */
  unregister(name: string): boolean {
    if (!this.detectors.has(name)) {
      return false;
    }

    this.detectors.delete(name);
    this.statusCache.delete(name);

    // Remove from category
    for (const tools of this.categoryMap.values()) {
      tools.delete(name);
    }

    logger.debug(`Unregistered detector: ${name}`);
    return true;
  }

  /**
   * Detect a single tool
   * @param name Tool name
   * @param force Force detection, bypass cache
   */
  async detect(name: string, force = false): Promise<ToolStatus> {
    const detector = this.detectors.get(name);
    if (!detector) {
      return {
        available: false,
        error: `No detector registered for '${name}'`,
      };
    }

    // Return cached result if available and not forced
    if (!force && this.statusCache.has(name)) {
      return this.statusCache.get(name)!;
    }

    try {
      logger.debug(`Detecting tool: ${name}`);
      const status = await detector.detect();
      status.lastChecked = new Date();
      this.statusCache.set(name, status);

      logger.debug(`Tool ${name} detection result:`, {
        available: status.available,
        path: status.path,
        version: status.version,
      });

      return status;
    } catch (error) {
      const status: ToolStatus = {
        available: false,
        error: (error as Error).message,
        lastChecked: new Date(),
      };
      this.statusCache.set(name, status);
      logger.error(`Error detecting tool ${name}:`, error);
      return status;
    }
  }

  /**
   * Detect all registered tools
   * @param force Force detection, bypass cache
   */
  async detectAll(force = false): Promise<Map<string, ToolStatus>> {
    const results = new Map<string, ToolStatus>();

    await Promise.all(
      Array.from(this.detectors.keys()).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Detect all tools in a category
   * @param category Tool category
   * @param force Force detection, bypass cache
   */
  async detectCategory(category: ToolCategory, force = false): Promise<Map<string, ToolStatus>> {
    const tools = this.categoryMap.get(category);
    if (!tools) {
      return new Map();
    }

    const results = new Map<string, ToolStatus>();

    await Promise.all(
      Array.from(tools).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Get cached status for a tool
   * @param name Tool name
   */
  getStatus(name: string): ToolStatus | undefined {
    return this.statusCache.get(name);
  }

  /**
   * Get all cached statuses
   */
  getAllStatus(): Map<string, ToolStatus> {
    return new Map(this.statusCache);
  }

  /**
   * Get the best available tool in a category
   * Returns the first available tool sorted by priority
   * @param category Tool category
   */
  async getBestTool(category: ToolCategory): Promise<string | null> {
    const tools = this.categoryMap.get(category);
    if (!tools || tools.size === 0) {
      return null;
    }

    // Get detectors and sort by priority
    const sortedDetectors = Array.from(tools)
      .map((name) => this.detectors.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // Find first available tool
    for (const detector of sortedDetectors) {
      const status = await this.detect(detector.name);
      if (status.available) {
        return detector.name;
      }
    }

    return null;
  }

  /**
   * Get all tools in a category, sorted by priority
   * @param category Tool category
   */
  getToolsInCategory(category: ToolCategory): IToolDetector[] {
    const tools = this.categoryMap.get(category);
    if (!tools) {
      return [];
    }

    return Array.from(tools)
      .map((name) => this.detectors.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Clear status cache
   * @param name Optional tool name; if not provided, clears all
   */
  clearCache(name?: string): void {
    if (name) {
      this.statusCache.delete(name);
      logger.debug(`Cleared cache for: ${name}`);
    } else {
      this.statusCache.clear();
      logger.debug('Cleared all cache');
    }
  }

  /**
   * Get all registered tool names
   */
  getRegisteredTools(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * Get all categories
   */
  getCategories(): ToolCategory[] {
    return Array.from(this.categoryMap.keys());
  }

  /**
   * Check if a tool is registered
   */
  isRegistered(name: string): boolean {
    return this.detectors.has(name);
  }
}

// ========================================
// Helper: Create a command-based detector
// ========================================

/**
 * Create a simple command-based detector
 * Useful for common tools that follow standard patterns
 */
export function createCommandDetector(
  name: string,
  options: {
    description?: string;
    priority?: number;
    versionFlag?: string;
    whichCommand?: string;
  } = {},
): IToolDetector {
  const { description, priority, versionFlag = '--version', whichCommand } = options;

  return {
    description,
    async detect(): Promise<ToolStatus> {
      try {
        const resolvedCommand = whichCommand
          ? await (async (): Promise<ResolvedCommand | undefined> => {
              const lines = await getCommandPathLines(whichCommand as 'where' | 'which', name);
              if (!lines) return;
              return { path: isWindows() ? pickWindowsRunnable(lines) || lines[0] : lines[0] };
            })()
          : await resolveCommandPath(name);

        if (!resolvedCommand) return { available: false };

        // Try to get version
        let version: string | undefined;
        try {
          const isCmdShim = isWindows() && /\.(?:cmd|bat)$/i.test(resolvedCommand.path);
          const { stderr, stdout } = isCmdShim
            ? await execPromise(`"${resolvedCommand.path}" ${versionFlag}`, {
                env: resolvedCommand.env,
                timeout: 3000,
                windowsHide: true,
              })
            : await execFilePromise(resolvedCommand.path, [versionFlag], {
                env: resolvedCommand.env,
                timeout: 3000,
                windowsHide: true,
              });
          version = `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0];
        } catch {
          // Some tools don't support version flag
        }

        return {
          available: true,
          path: resolvedCommand.path,
          resolvedPathEnv: resolvedCommand.env?.PATH,
          version,
        };
      } catch {
        return {
          available: false,
        };
      }
    },
    name,
    priority,
  };
}

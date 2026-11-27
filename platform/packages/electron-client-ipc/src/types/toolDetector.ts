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
 * Tool categories
 */
export type ToolCategory =
  | 'content-search'
  | 'ast-search'
  | 'custom'
  | 'file-search'
  | 'runtime-environment'
  | 'system';

/**
 * Tool info for display
 */
export interface ToolInfo {
  description?: string;
  name: string;
  priority?: number;
}

export type HeterogeneousCliAgentType = 'claude-code' | 'codex';

export interface ToolInstallResult {
  commandLabel?: string;
  error?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  success: boolean;
  toolName: string;
}

export type RuntimeName = 'node' | 'python' | 'bun' | 'uv' | 'rg' | 'fd';
export type InstallPhase = 'download' | 'verify' | 'extract' | 'switch' | 'done' | 'error';

export interface InstallProgressEvent {
  downloaded?: number;
  error?: string;
  message?: string;
  percent?: number;
  phase: InstallPhase;
  toolName: RuntimeName;
  total?: number;
}

export interface RuntimeInstallResult {
  error?: string;
  skipped?: boolean;
  success: boolean;
  toolName: RuntimeName;
  version?: string;
}

export interface RuntimeUninstallResult {
  alreadyGone?: boolean;
  error?: string;
  success: boolean;
  toolName: RuntimeName;
}

import path from 'node:path';

import type {
  EditLocalFileParams,
  EditLocalFileResult,
  GatewayConnectionStatus,
  GetCommandOutputParams,
  GlobFilesParams,
  GlobFilesResult,
  GrepContentParams,
  GrepContentResult,
  KillCommandParams,
  KillCommandResult,
  ListLocalFileParams,
  LocalReadFileParams,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RunCommandParams,
  RunCommandResult,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';

import GatewayConnectionService, { type ToolCallResult } from '@/services/gatewayConnectionSrv';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

const logger = createLogger('controllers:GatewayConnectionCtr');

/**
 * Resolve a `scope`-bearing args object, joining a relative path field against
 * the scope (CWD). Inlined node:path copy of the renderer-side
 * `resolveArgsWithScope` (in `@lobechat/builtin-tool-local-system`) so the
 * device path resolves the same way the in-process executor does, without
 * pulling that package's `@lobechat/types` chain into the main process.
 */
const resolveArgsWithScope = <T extends { scope?: string }>(args: T, field: string): T => {
  const scope = (args as Record<string, unknown>).scope as string | undefined;
  if (!scope) return args;
  const current = (args as Record<string, unknown>)[field] as string | undefined;
  if (!current) return { ...args, [field]: scope };
  if (path.isAbsolute(current)) return args;
  return { ...args, [field]: path.join(scope, current) };
};

const joinNonEmpty = (parts: (string | undefined)[]): string =>
  parts.filter((p) => p && p.length > 0).join('\n');

/**
 * GatewayConnectionCtr
 *
 * Thin IPC layer over GatewayConnectionService. Wires the token provider and the
 * local-system tool-call handler, and exposes connect/disconnect/status to the
 * renderer so the user can turn this desktop into an execution device.
 */
export default class GatewayConnectionCtr extends ControllerModule {
  static override readonly groupName = 'gatewayConnection';

  // ─── Service / Controller Accessors ───

  private get service() {
    return this.app.getService(GatewayConnectionService);
  }

  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  private get localFileCtr() {
    return this.app.getController(LocalFileCtr);
  }

  private get shellCommandCtr() {
    return this.app.getController(ShellCommandCtr);
  }

  // ─── Lifecycle ───

  afterAppReady() {
    const srv = this.service;

    srv.loadOrCreateDeviceId();
    srv.setTokenProvider(() => this.remoteServerConfigCtr.getAccessToken());
    srv.setTokenRefresher(() => this.remoteServerConfigCtr.refreshAccessToken());
    srv.setToolCallHandler((apiName, args) => this.executeToolCall(apiName, args));
    srv.setOnConnectedCallback(() => this.registerDevice());

    this.tryAutoConnect();
  }

  // ─── IPC Methods (Renderer → Main) ───

  @IpcMethod()
  async connect(): Promise<{ error?: string; success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', true);
    return this.service.connect();
  }

  @IpcMethod()
  async disconnect(): Promise<{ success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', false);
    return this.service.disconnect();
  }

  @IpcMethod()
  async getConnectionStatus(): Promise<{ status: GatewayConnectionStatus }> {
    return { status: this.service.getStatus() as GatewayConnectionStatus };
  }

  /**
   * Best-effort connect the renderer can call right after it learns login
   * succeeded (onboarding / re-auth), so the device doesn't have to wait for
   * the next app restart to pick up a token that didn't exist at
   * `afterAppReady` time. Shares `tryAutoConnect`'s gating, so an explicit
   * prior `disconnect()` (gatewayEnabled === false) is respected instead of
   * being silently re-enabled.
   */
  @IpcMethod()
  async connectIfEnabled(): Promise<{ error?: string; success: boolean }> {
    return this.tryAutoConnect();
  }

  @IpcMethod()
  async getDeviceInfo(): Promise<{
    description: string;
    deviceId: string;
    hostname: string;
    name: string;
    platform: string;
  }> {
    return this.service.getDeviceInfo();
  }

  @IpcMethod()
  async setDeviceName(params: { name: string }): Promise<{ success: boolean }> {
    this.service.setDeviceName(params.name);
    return { success: true };
  }

  @IpcMethod()
  async setDeviceDescription(params: { description: string }): Promise<{ success: boolean }> {
    this.service.setDeviceDescription(params.description);
    return { success: true };
  }

  // ─── Auto Connect ───

  private async tryAutoConnect(): Promise<{ error?: string; success: boolean }> {
    // Default ON: connect unless the user has explicitly turned it off. A first
    // run (value unset/undefined) auto-connects; only an explicit `disconnect()`
    // (which persists `gatewayEnabled = false`) opts out and is respected here.
    const gatewayEnabled = this.app.storeManager.get('gatewayEnabled');
    if (gatewayEnabled === false) return { success: false };

    const isConfigured = await this.remoteServerConfigCtr.isRemoteServerConfigured();
    if (!isConfigured) return { success: false };

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) return { success: false };

    return this.service.connect();
  }

  /**
   * Called once the WebSocket reaches 'connected' state. Upserts this device
   * in the server DB so it appears (with the correct online indicator) in the
   * Devices settings page.
   */
  private async registerDevice() {
    try {
      const token = await this.remoteServerConfigCtr.getAccessToken();
      if (!token) return;

      const serverUrl = await this.remoteServerConfigCtr.getRemoteServerUrl();
      if (!serverUrl) return;

      const info = this.service.getDeviceInfo();
      const identitySource = this.service.getIdentitySource() ?? 'fallback';

      const body = {
        json: {
          deviceId: info.deviceId,
          hostname: info.hostname,
          identitySource,
          platform: info.platform,
        },
      };

      const endpoint = new URL('/trpc/lambda/device.register', serverUrl).toString();
      const res = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'Oidc-Auth': token,
        },
        method: 'POST',
      });

      if (!res.ok) {
        logger.warn(`device.register failed: ${res.status} ${res.statusText}`);
      } else {
        logger.info(`Device registered: deviceId=${info.deviceId}`);
      }
    } catch (err) {
      logger.warn('device.register error:', err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Local-System Tool Call Routing ───

  /**
   * Run a local-system tool call dispatched from the cloud server via the
   * gateway. Maps the manifest `apiName` to the existing LocalFileCtr /
   * ShellCommandCtr handlers (the same primitives the in-process executor uses),
   * then formats the structured result into the LLM-facing `content` string the
   * wire protocol carries. lark-cli resolves automatically: `ensureLarkCliShim`
   * (run at startup, before this controller's `afterAppReady`) prepends the
   * bundled binary's shim dir to `process.env.PATH`, which `runCommand` inherits.
   */
  private async executeToolCall(apiName: string, args: unknown): Promise<ToolCallResult> {
    logger.debug(`executeToolCall: ${apiName}`);
    // Args arrive as untyped JSON from the model; each branch casts to its
    // manifest param shape after this single `unknown` hop.
    const a = (args ?? {}) as any;

    switch (apiName) {
      case 'runCommand': {
        const r = await this.shellCommandCtr.handleRunCommand(a as RunCommandParams);
        return this.fromRunCommand(r);
      }
      case 'getCommandOutput': {
        const r = await this.shellCommandCtr.handleGetCommandOutput(a as GetCommandOutputParams);
        return {
          content: joinNonEmpty([r.output, r.running ? '[command still running]' : undefined]),
          error: r.error,
          success: r.success,
        };
      }
      case 'killCommand': {
        const r: KillCommandResult = await this.shellCommandCtr.handleKillCommand(
          a as KillCommandParams,
        );
        return {
          content: r.success ? 'Command killed' : (r.error ?? 'Failed to kill command'),
          error: r.error,
          success: r.success,
        };
      }
      case 'readLocalFile': {
        const r = await this.localFileCtr.readFile(a as LocalReadFileParams);
        return { content: r.content, success: true };
      }
      case 'readLocalFiles': {
        const rs = await this.localFileCtr.readFiles(a as LocalReadFilesParams);
        return {
          content: rs.map((r) => `# ${r.filename}\n${r.content}`).join('\n\n'),
          success: true,
        };
      }
      case 'listLocalFiles': {
        const r = await this.localFileCtr.listLocalFiles(a as ListLocalFileParams);
        const lines = r.files.map((f) => `${f.isDirectory ? 'd' : '-'} ${f.path}`);
        return {
          content: joinNonEmpty([`total ${r.totalCount}`, ...lines]),
          success: true,
        };
      }
      case 'searchLocalFiles': {
        const params = resolveArgsWithScope(a as LocalSearchFilesParams, 'directory');
        const rs = await this.localFileCtr.handleLocalFilesSearch(params);
        return {
          content: joinNonEmpty([`${rs.length} result(s)`, ...rs.map((f) => f.path)]),
          success: true,
        };
      }
      case 'grepContent': {
        const params = resolveArgsWithScope(a as GrepContentParams, 'path');
        const r: GrepContentResult = await this.localFileCtr.handleGrepContent(params);
        return {
          content: joinNonEmpty([`${r.total_matches} match(es)`, ...r.matches]),
          error: r.error,
          success: r.success,
        };
      }
      case 'globLocalFiles': {
        const params = resolveArgsWithScope(a as GlobFilesParams, 'pattern');
        const r: GlobFilesResult = await this.localFileCtr.handleGlobFiles(params);
        return {
          content: joinNonEmpty([`${r.total_files} file(s)`, ...r.files]),
          error: r.error,
          success: r.success,
        };
      }
      case 'writeLocalFile': {
        const p = a as WriteLocalFileParams;
        await this.localFileCtr.handleWriteFile(p);
        return { content: `File written: ${p.path}`, success: true };
      }
      case 'editLocalFile': {
        const r: EditLocalFileResult = await this.localFileCtr.handleEditFile(
          a as EditLocalFileParams,
        );
        return {
          content: joinNonEmpty([
            r.success ? `Edited (${r.replacements} replacement(s))` : 'Edit failed',
            r.diffText,
          ]),
          error: r.error,
          success: r.success,
        };
      }
      case 'moveLocalFiles': {
        const rs = await this.localFileCtr.handleMoveFiles(a as MoveLocalFilesParams);
        return {
          content: rs
            .map((r) =>
              r.success
                ? `moved ${r.sourcePath} → ${r.newPath}`
                : `failed ${r.sourcePath}: ${r.error}`,
            )
            .join('\n'),
          success: rs.every((r) => r.success),
        };
      }
      case 'renameLocalFile': {
        const r = await this.localFileCtr.handleRenameFile(a as { newName: string; path: string });
        return {
          content: r.success ? `renamed → ${r.newPath}` : `rename failed: ${r.error}`,
          error: r.error,
          success: r.success,
        };
      }
      default: {
        return {
          content: `Unsupported local-system apiName "${apiName}"`,
          error: 'unsupported_api',
          success: false,
        };
      }
    }
  }

  private fromRunCommand(r: RunCommandResult): ToolCallResult {
    const body = r.output ?? joinNonEmpty([r.stdout, r.stderr]);
    return {
      content: joinNonEmpty([
        body || (r.error ?? ''),
        r.shell_id ? `[shell_id: ${r.shell_id}]` : undefined,
        typeof r.exit_code === 'number' && r.exit_code !== 0
          ? `[exit code: ${r.exit_code}]`
          : undefined,
      ]),
      error: r.error,
      success: r.success,
    };
  }
}

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type ConnectionStatus,
  GatewayClient,
  type RpcRequestMessage,
  type SystemInfoRequestMessage,
  type ToolCallRequestMessage,
  type ToolCallResponseMessage,
} from '@lobechat/device-gateway-client';
import { app, powerSaveBlocker } from 'electron';

import { getDesktopEnv } from '@/env';
import type { IdentitySource } from '@/utils/deviceIdentity';
import { deriveDeviceId } from '@/utils/deviceIdentity';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

const DEFAULT_GATEWAY_URL = 'https://zx-device-gateway.train.ctripcorp.com';

/**
 * Result a tool-call handler must return — the LLM-facing `content` plus the
 * success/error flags the wire protocol carries (TripYoYo's protocol does not
 * carry structured `state`, so the device only returns prompt-facing text).
 */
export interface ToolCallResult {
  content: string;
  error?: unknown;
  success: boolean;
}

interface ToolCallHandler {
  (apiName: string, args: unknown): Promise<ToolCallResult>;
}

/**
 * Coerce a runtime error into the string the wire protocol expects. Returns
 * undefined when there's no error to transmit.
 */
const serializeWireError = (err: unknown): string | undefined => {
  if (err === undefined || err === null) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

/**
 * GatewayConnectionService
 *
 * Manages the WebSocket connection that turns this desktop into an execution
 * device: it authenticates to the cloud device-gateway, then receives
 * `tool_call_request` / `system_info_request` and runs them locally (via the
 * controller's handlers). Trimmed from LobeHub's version — the hetero
 * (`agent_run`), IM (`message_api`), generic RPC and stdio-MCP tunnel channels
 * are intentionally NOT ported (out of scope: native device tools only).
 */
export default class GatewayConnectionService extends ServiceModule {
  private client: GatewayClient | null = null;
  private status: ConnectionStatus = 'disconnected';
  private deviceId: string | null = null;
  private powerSaveBlockerId: number | null = null;

  private identitySource: IdentitySource | null = null;

  private tokenProvider: (() => Promise<string | null>) | null = null;
  private tokenRefresher: (() => Promise<{ error?: string; success: boolean }>) | null = null;
  private toolCallHandler: ToolCallHandler | null = null;
  private onConnectedCallback: (() => void) | null = null;

  // ─── Configuration ───

  setTokenProvider(provider: () => Promise<string | null>) {
    this.tokenProvider = provider;
  }

  setTokenRefresher(refresher: () => Promise<{ error?: string; success: boolean }>) {
    this.tokenRefresher = refresher;
  }

  /** Route incoming local-system tool calls to LocalFileCtr / ShellCommandCtr. */
  setToolCallHandler(handler: ToolCallHandler) {
    this.toolCallHandler = handler;
  }

  /** Called once each time the WebSocket reaches 'connected' state. */
  setOnConnectedCallback(cb: () => void) {
    this.onConnectedCallback = cb;
  }

  // ─── Device ID ───

  /**
   * Ensure a stored fallback id exists. Pre-login this doubles as the device id
   * shown by `getDeviceInfo`; once a userId is available `resolveDeviceIdentity`
   * replaces it with a stable machine-derived id.
   */
  loadOrCreateDeviceId() {
    const stored = this.app.storeManager.get('gatewayDeviceId');
    if (stored) {
      this.deviceId = stored;
    } else {
      this.deviceId = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', this.deviceId);
    }
    logger.debug(`Device ID: ${this.deviceId}`);
  }

  /**
   * Derive the stable, user-scoped device id. Survives reinstalls because it
   * hashes the OS machine id; falls back to the stored random UUID when the
   * machine id is unavailable. Caches the result for this session.
   */
  resolveDeviceIdentity(userId: string): { deviceId: string; identitySource: IdentitySource } {
    const fallbackId = this.app.storeManager.get('gatewayDeviceId');
    const identity = deriveDeviceId(userId, { fallbackId });
    this.deviceId = identity.deviceId;
    this.identitySource = identity.identitySource;
    return identity;
  }

  getDeviceId(): string {
    return this.deviceId || 'unknown';
  }

  getIdentitySource(): IdentitySource | null {
    return this.identitySource;
  }

  // ─── Connection Status ───

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getDeviceInfo() {
    return {
      description: this.getDeviceDescription(),
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      name: this.getDeviceName(),
      platform: process.platform,
    };
  }

  // ─── Device Name & Description ───

  getDeviceName(): string {
    return this.app.storeManager.get('gatewayDeviceName') || os.hostname();
  }

  setDeviceName(name: string) {
    this.app.storeManager.set('gatewayDeviceName', name);
  }

  getDeviceDescription(): string {
    return this.app.storeManager.get('gatewayDeviceDescription') || '';
  }

  setDeviceDescription(description: string) {
    this.app.storeManager.set('gatewayDeviceDescription', description);
  }

  // ─── Connection Logic ───

  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    return this.doConnect();
  }

  async disconnect(): Promise<{ success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.setStatus('disconnected');
    return { success: true };
  }

  private async doConnect(): Promise<{ error?: string; success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenProvider) {
      logger.warn('Cannot connect: no token provider configured');
      return { error: 'No token provider configured', success: false };
    }

    const token = await this.tokenProvider();
    if (!token) {
      logger.warn('Cannot connect: no access token');
      return { error: 'No access token available', success: false };
    }

    const gatewayUrl = this.getGatewayUrl();
    const userId = this.extractUserIdFromToken(token);
    logger.info(`Connecting to device gateway: ${gatewayUrl}, userId: ${userId || 'unknown'}`);

    // Resolve the stable, user-scoped device id so the device shows up under a
    // routable id that survives reinstalls.
    if (userId) this.resolveDeviceIdentity(userId);

    const client = new GatewayClient({
      deviceId: this.getDeviceId(),
      gatewayUrl,
      logger,
      token,
      userId: userId || undefined,
    });

    this.setupClientEvents(client);
    this.client = client;

    await client.connect();
    return { success: true };
  }

  private setupClientEvents(client: GatewayClient) {
    client.on('status_changed', (status) => {
      this.setStatus(status);
    });

    client.on('tool_call_request', (request) => {
      this.handleToolCallRequest(request, client);
    });

    client.on('system_info_request', (request) => {
      this.handleSystemInfoRequest(client, request);
    });

    client.on('rpc_request', (request) => {
      this.handleRpcRequest(client, request);
    });

    client.on('auth_expired', () => {
      logger.warn('Received auth_expired, will reconnect with refreshed token');
      this.handleAuthExpired();
    });

    client.on('error', (error) => {
      logger.error('WebSocket error:', error.message);
    });
  }

  // ─── Auth Expired Handling ───

  private async handleAuthExpired() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot handle auth_expired');
      this.setStatus('disconnected');
      return;
    }

    logger.info('Attempting token refresh before reconnect');
    const result = await this.tokenRefresher();

    if (result.success) {
      logger.info('Token refreshed, reconnecting');
      await this.doConnect();
    } else {
      logger.error('Token refresh failed:', result.error);
      this.setStatus('disconnected');
    }
  }

  // ─── System Info ───

  private handleSystemInfoRequest(client: GatewayClient, request: SystemInfoRequestMessage) {
    logger.info(`Received system_info_request: requestId=${request.requestId}`);
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: {
        success: true,
        systemInfo: {
          arch: os.arch(),
          desktopPath: app.getPath('desktop'),
          documentsPath: app.getPath('documents'),
          downloadsPath: app.getPath('downloads'),
          homePath: app.getPath('home'),
          musicPath: app.getPath('music'),
          picturesPath: app.getPath('pictures'),
          userDataPath: app.getPath('userData'),
          videosPath: app.getPath('videos'),
          workingDirectory: process.cwd(),
        },
      },
    });
  }

  // ─── RPC Routing ───

  /**
   * Handle generic RPC requests (statPath, git operations, etc.). Dispatches to
   * the appropriate handler based on `request.method` and sends back a
   * `rpc_response` message. Unknown methods return an error.
   */
  private async handleRpcRequest(client: GatewayClient, request: RpcRequestMessage) {
    const { method, params, requestId } = request;
    logger.info(`Received rpc_request: method=${method}, requestId=${requestId}`);

    try {
      const result = await this.dispatchRpcMethod(method, params);
      client.sendRpcResponse({
        requestId,
        result: { data: result, success: true },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`RPC failed: method=${method}, error=${errorMsg}`);
      client.sendRpcResponse({
        requestId,
        result: { error: errorMsg, success: false },
      });
    }
  }

  /**
   * Dispatch an RPC method by name. Returns the method's result (serialized as
   * JSON by the caller). Currently supports:
   * - `statPath`: check if a path exists and is a directory, detect repo type
   */
  private async dispatchRpcMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'statPath': {
        const { path: targetPath } = params as { path: string };
        return this.rpcStatPath(targetPath);
      }
      // Git methods return undefined (offline) — the desktop app doesn't yet
      // have a GitController to execute git operations via IPC. The UI degrades
      // gracefully when these return undefined.
      case 'getGitBranch':
      case 'getLinkedPullRequest':
      case 'getGitWorkingTreeStatus':
      case 'getGitAheadBehind':
      case 'listGitWorktrees':
      case 'listGitBranches':
      case 'listGitRemoteBranches':
      case 'getGitWorkingTreePatches':
      case 'getGitBranchDiff':
      case 'getGitWorkingTreeFiles':
      case 'listProjectSkills':
      case 'getProjectFileIndex':
      case 'getLocalFilePreview':
      case 'initWorkspace': {
        return undefined;
      }
      default: {
        throw new Error(`Unknown RPC method: ${method}`);
      }
    }
  }

  /**
   * Check whether a path exists and is a directory. Optionally detect the repo
   * type (git / github) by looking for a `.git` directory or checking the
   * remote URL.
   */
  private async rpcStatPath(targetPath: string): Promise<{
    exists: boolean;
    isDirectory: boolean;
    repoType?: 'git' | 'github';
  }> {
    try {
      const stat = await fs.promises.stat(targetPath);
      const exists = true;
      const isDirectory = stat.isDirectory();

      if (!isDirectory) {
        return { exists, isDirectory };
      }

      // Detect repo type
      const gitDir = path.join(targetPath, '.git');
      const hasGit = fs.existsSync(gitDir);
      if (!hasGit) {
        return { exists, isDirectory };
      }

      // Check if it's a GitHub repo by reading .git/config
      const configPath = path.join(gitDir, 'config');
      if (fs.existsSync(configPath)) {
        const config = fs.readFileSync(configPath, 'utf8');
        if (config.includes('github.com')) {
          return { exists, isDirectory, repoType: 'github' };
        }
      }

      return { exists, isDirectory, repoType: 'git' };
    } catch {
      return { exists: false, isDirectory: false };
    }
  }

  // ─── Tool Call Routing ───

  private handleToolCallRequest = async (
    request: ToolCallRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, toolCall } = request;
    const { apiName, arguments: argsStr } = toolCall;

    logger.info(`Received tool call: apiName=${apiName}, requestId=${requestId}`);

    try {
      if (!this.toolCallHandler) throw new Error('No tool call handler configured');

      const args = JSON.parse(argsStr);
      const result = await this.toolCallHandler(apiName, args);

      const wireResult: ToolCallResponseMessage['result'] = {
        content: result.content,
        success: result.success,
      };
      const wireError = serializeWireError(result.error);
      if (wireError !== undefined) wireResult.error = wireError;

      client.sendToolCallResponse({ requestId, result: wireResult });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: apiName=${apiName}, error=${errorMsg}`);
      client.sendToolCallResponse({
        requestId,
        result: { content: errorMsg, error: errorMsg, success: false },
      });
    }
  };

  // ─── Power Save Blocker ───

  /**
   * Prevent macOS App Nap from suspending the process while connected (which
   * would drop the WebSocket). Uses 'prevent-app-suspension' so the display can
   * still sleep — only the app process is kept alive.
   */
  private startPowerSaveBlocker() {
    if (this.powerSaveBlockerId !== null) return;
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    logger.info(`Power save blocker started (id=${this.powerSaveBlockerId})`);
  }

  private stopPowerSaveBlocker() {
    if (this.powerSaveBlockerId === null) return;
    powerSaveBlocker.stop(this.powerSaveBlockerId);
    logger.info(`Power save blocker stopped (id=${this.powerSaveBlockerId})`);
    this.powerSaveBlockerId = null;
  }

  // ─── Status Broadcasting ───

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;

    logger.info(`Connection status: ${this.status} → ${status}`);
    this.status = status;

    if (status === 'connected') {
      this.startPowerSaveBlocker();
      this.onConnectedCallback?.();
    } else {
      this.stopPowerSaveBlocker();
    }

    this.app.browserManager.broadcastToAllWindows('gatewayConnectionStatusChanged', { status });
  }

  // ─── Gateway URL ───

  private getGatewayUrl(): string {
    // Env override wins (dev: point at a local mock gateway), then the
    // user-configured store value, then the production default.
    return (
      getDesktopEnv().DEVICE_GATEWAY_URL ||
      this.app.storeManager.get('gatewayUrl') ||
      DEFAULT_GATEWAY_URL
    );
  }

  // ─── Token Helpers ───

  /**
   * Extract userId (sub claim) from JWT without verification. The token is
   * verified server-side; we just need the userId for device routing.
   */
  private extractUserIdFromToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.sub || null;
    } catch {
      logger.warn('Failed to extract userId from JWT token');
      return null;
    }
  }
}

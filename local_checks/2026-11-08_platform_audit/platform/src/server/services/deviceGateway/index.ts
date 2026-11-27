import path from 'node:path';

import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import {
  type DeviceStatusResult,
  type DeviceSystemInfo,
  type DeviceToolCallResult,
  GatewayHttpClient,
} from '@lobechat/device-gateway-client';
import type {
  DeviceGitAheadBehind,
  DeviceGitBranchDiffPatches,
  DeviceGitBranchInfo,
  DeviceGitBranchListItem,
  DeviceGitCheckoutResult,
  DeviceGitDeleteBranchResult,
  DeviceGitFileRevertResult,
  DeviceGitLinkedPullRequestResult,
  DeviceGitRemoteBranchListItem,
  DeviceGitRenameBranchResult,
  DeviceGitSyncResult,
  DeviceGitWorkingTreeFiles,
  DeviceGitWorkingTreePatches,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
  DeviceListProjectSkillsResult,
  DeviceLocalFilePreviewResult,
  DeviceMoveProjectFileItem,
  DeviceMoveProjectFileResultItem,
  DeviceProjectFileIndexResult,
  DeviceRenameProjectFileResult,
  DeviceWriteProjectFileResult,
  ProjectSkillMeta,
  WorkspaceInitResult,
} from '@lobechat/types';
import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:device-gateway');

/**
 * Is `target` the same as, or nested inside, `root`?
 *
 * The device's working directory may be a POSIX path (`/Users/…`) or a Windows
 * path (`C:\…`) while this check runs on the cloud server (POSIX). We pick the
 * path flavour from the root's shape so a Windows device path is still resolved
 * with Windows semantics rather than being mangled by `path.posix`.
 */
export const isPathWithinRoot = (root: string, target: string): boolean => {
  const p = /^[A-Z]:[/\\]/i.test(root) ? path.win32 : path.posix;
  if (!p.isAbsolute(root) || !p.isAbsolute(target)) return false;
  const relative = p.relative(p.resolve(root), p.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !p.isAbsolute(relative));
};

/**
 * Guard the web/remote file mutations (move / rename / write) against escaping
 * the project root. These routes accept absolute paths straight from an
 * untrusted browser session, so before forwarding them to a device we confirm
 * every path stays inside the workspace the UI is operating in — otherwise a
 * caller could bypass the Files tree and mutate arbitrary locations on the
 * device. Mirrors the read path's `workspaceRoot` containment check.
 */
const assertPathsWithinWorkspace = (
  workspaceRoot: string,
  candidates: Array<string | undefined>,
): void => {
  if (!workspaceRoot) throw new Error('A workspace root is required for file mutations');

  for (const candidate of candidates) {
    if (!candidate || !isPathWithinRoot(workspaceRoot, candidate)) {
      throw new Error(`Path is outside the approved workspace: ${candidate ?? '(empty)'}`);
    }
  }
};

export type { DeviceAttachment, DeviceStatusResult, DeviceSystemInfo };

export class DeviceGateway {
  private client: GatewayHttpClient | null = null;

  get isConfigured(): boolean {
    return !!gatewayEnv.DEVICE_GATEWAY_URL;
  }

  async queryDeviceStatus(userId: string): Promise<DeviceStatusResult> {
    const client = this.getClient();
    if (!client) return { deviceCount: 0, online: false };

    try {
      return await client.queryDeviceStatus(userId);
    } catch {
      return { deviceCount: 0, online: false };
    }
  }

  async queryDeviceList(userId: string): Promise<DeviceAttachment[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const devices = await client.queryDeviceList(userId);
      // The gateway returns one attachment per live WebSocket connection; every
      // returned device has an active connection, so it's online.
      return devices.map((d) => ({
        deviceId: d.deviceId,
        hostname: d.hostname,
        lastSeen: new Date(d.connectedAt).toISOString(),
        online: true,
        platform: d.platform,
      }));
    } catch {
      return [];
    }
  }

  async queryDeviceSystemInfo(
    userId: string,
    deviceId: string,
  ): Promise<DeviceSystemInfo | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.getDeviceSystemInfo(userId, deviceId);
      return result.success ? result.systemInfo : undefined;
    } catch {
      log('queryDeviceSystemInfo: failed for userId=%s, deviceId=%s', userId, deviceId);
      return undefined;
    }
  }

  /**
   * Scan a bound project directory on the device in a single round-trip:
   * project skills (`.agents/skills` + `.claude/skills`) plus the root
   * `AGENTS.md` / `CLAUDE.md`. Routed through the generic device RPC relay
   * (`invokeRpc`) — a server-internal channel the agent never sees, distinct
   * from the LLM-facing tool-call path.
   */
  async initWorkspace(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<WorkspaceInitResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<{
        instructions?: WorkspaceInitResult['instructions'];
        skills?: (ProjectSkillMeta & Record<string, unknown>)[];
      }>({ deviceId, timeout, userId }, { method: 'initWorkspace', params: { scope } });

      if (!result.success || !result.data) {
        log('initWorkspace: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      const { instructions, skills } = result.data;
      return {
        instructions: instructions ?? [],
        skills: (skills ?? []).map(({ description, name, path }) => ({
          description,
          name,
          path,
        })),
      };
    } catch (error) {
      log('initWorkspace: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Generic helper for the granular git read RPCs (branch / PR / working-tree /
   * ahead-behind). Returns `undefined` when the gateway is unconfigured, the
   * device is offline, or the call fails — callers treat that as "unknown".
   */
  private async invokeGitRead<T>(
    method: string,
    params: { deviceId: string; timeout?: number; userId: string },
    rpcParams: Record<string, unknown>,
  ): Promise<T | undefined> {
    const { userId, deviceId, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<T>(
        { deviceId, timeout, userId },
        { method, params: rpcParams },
      );

      if (!result.success || result.data === undefined) {
        log('%s: failed for deviceId=%s — %s', method, deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('%s: error for deviceId=%s — %O', method, deviceId, error);
      return undefined;
    }
  }

  /** Branch name + detached flag for a directory on a remote device. */
  gitBranch(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitBranchInfo>('getGitBranch', params, { path: params.path });
  }

  /** The GitHub PR linked to a branch in a directory on a remote device. */
  gitLinkedPullRequest(params: { branch: string; deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitLinkedPullRequestResult>('getLinkedPullRequest', params, {
      branch: params.branch,
      path: params.path,
    });
  }

  /** Working-tree dirty-file counts for a directory on a remote device. */
  gitWorkingTreeStatus(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitWorkingTreeStatus>('getGitWorkingTreeStatus', params, {
      path: params.path,
    });
  }

  /** Ahead/behind commit counts for a directory on a remote device. */
  gitAheadBehind(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitAheadBehind>('getGitAheadBehind', params, {
      path: params.path,
    });
  }

  /** Git worktrees attached to the same repository as a directory on a remote device. */
  listGitWorktrees(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitWorktreeListItem[]>('listGitWorktrees', params, {
      path: params.path,
    });
  }

  /** List the local branches of a directory on a remote device. */
  async listGitBranches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitBranchListItem[] | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitBranchListItem[]>(
        { deviceId, timeout, userId },
        { method: 'listGitBranches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('listGitBranches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listGitBranches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Checkout (or create) a branch in a directory on a remote device. */
  async checkoutGitBranch(params: {
    branch: string;
    create?: boolean;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitCheckoutResult> {
    const { userId, deviceId, branch, create, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitCheckoutResult>(
        { deviceId, timeout, userId },
        { method: 'checkoutGitBranch', params: { branch, create, path } },
      );

      if (!result.success || !result.data) {
        log('checkoutGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Checkout failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('checkoutGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Checkout failed', success: false };
    }
  }

  /** Rename a branch in a directory on a remote device. */
  async renameGitBranch(params: {
    deviceId: string;
    from: string;
    path: string;
    timeout?: number;
    to: string;
    userId: string;
  }): Promise<DeviceGitRenameBranchResult> {
    const { userId, deviceId, from, to, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitRenameBranchResult>(
        { deviceId, timeout, userId },
        { method: 'renameGitBranch', params: { from, path, to } },
      );

      if (!result.success || !result.data) {
        log('renameGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Rename failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('renameGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Rename failed', success: false };
    }
  }

  /** Delete a branch in a directory on a remote device. */
  async deleteGitBranch(params: {
    branch: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitDeleteBranchResult> {
    const { userId, deviceId, branch, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitDeleteBranchResult>(
        { deviceId, timeout, userId },
        { method: 'deleteGitBranch', params: { branch, path } },
      );

      if (!result.success || !result.data) {
        log('deleteGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Delete failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('deleteGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Delete failed', success: false };
    }
  }

  /** Pull (`--ff-only`) the current branch of a directory on a remote device. */
  async pullGitBranch(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitSyncResult> {
    const { userId, deviceId, path, timeout = 65_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitSyncResult>(
        { deviceId, timeout, userId },
        { method: 'pullGitBranch', params: { path } },
      );

      if (!result.success || !result.data) {
        log('pullGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Pull failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('pullGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Pull failed', success: false };
    }
  }

  /** Push the current branch of a directory on a remote device. */
  async pushGitBranch(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitSyncResult> {
    const { userId, deviceId, path, timeout = 65_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitSyncResult>(
        { deviceId, timeout, userId },
        { method: 'pushGitBranch', params: { path } },
      );

      if (!result.success || !result.data) {
        log('pushGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Push failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('pushGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Push failed', success: false };
    }
  }

  /** Working-tree (unstaged) per-file patches for a directory on a remote device. */
  async getGitWorkingTreePatches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitWorkingTreePatches | undefined> {
    const { userId, deviceId, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitWorkingTreePatches>(
        { deviceId, timeout, userId },
        { method: 'getGitWorkingTreePatches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('getGitWorkingTreePatches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitWorkingTreePatches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Branch diff (current branch vs base ref) per-file patches for a directory on a remote device. */
  async getGitBranchDiff(params: {
    baseRef?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitBranchDiffPatches | undefined> {
    const { userId, deviceId, baseRef, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitBranchDiffPatches>(
        { deviceId, timeout, userId },
        { method: 'getGitBranchDiff', params: { baseRef, path } },
      );

      if (!result.success || !result.data) {
        log('getGitBranchDiff: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitBranchDiff: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Repo-relative paths of dirty working-tree files for a directory on a remote device. */
  async getGitWorkingTreeFiles(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitWorkingTreeFiles | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitWorkingTreeFiles>(
        { deviceId, timeout, userId },
        { method: 'getGitWorkingTreeFiles', params: { path } },
      );

      if (!result.success || !result.data) {
        log('getGitWorkingTreeFiles: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitWorkingTreeFiles: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Project file index (tree) for a directory on a remote device. */
  async getProjectFileIndex(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceProjectFileIndexResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceProjectFileIndexResult>(
        { deviceId, timeout, userId },
        { method: 'getProjectFileIndex', params: { scope } },
      );

      if (!result.success || !result.data) {
        log('getProjectFileIndex: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getProjectFileIndex: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Read a preview payload for a file on a remote device (read-only). */
  async getLocalFilePreview(params: {
    accept?: 'image';
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
  }): Promise<DeviceLocalFilePreviewResult> {
    const { accept, userId, deviceId, path, workingDirectory, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceLocalFilePreviewResult>(
        { deviceId, timeout, userId },
        {
          method: 'getLocalFilePreview',
          params: { accept, path, workingDirectory },
        },
      );

      if (!result.success || !result.data) {
        log('getLocalFilePreview: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Failed to load local file preview', success: false };
      }

      return result.data;
    } catch (error) {
      log('getLocalFilePreview: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error).message, success: false };
    }
  }

  /** Project skills (`.agents/skills` / `.claude/skills`) for a directory on a remote device. */
  async listProjectSkills(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceListProjectSkillsResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceListProjectSkillsResult>(
        { deviceId, timeout, userId },
        { method: 'listProjectSkills', params: { scope } },
      );

      if (!result.success || !result.data) {
        log('listProjectSkills: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listProjectSkills: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** List the remote branches (`refs/remotes/origin/*`) of a directory on a remote device. */
  async listGitRemoteBranches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitRemoteBranchListItem[] | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitRemoteBranchListItem[]>(
        { deviceId, timeout, userId },
        { method: 'listGitRemoteBranches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('listGitRemoteBranches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listGitRemoteBranches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /** Revert (discard working-tree changes to) a single file in a directory on a remote device. */
  async revertGitFile(params: {
    deviceId: string;
    filePath: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitFileRevertResult> {
    const { userId, deviceId, filePath, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitFileRevertResult>(
        { deviceId, timeout, userId },
        { method: 'revertGitFile', params: { filePath, path } },
      );

      if (!result.success || !result.data) {
        log('revertGitFile: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Revert failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('revertGitFile: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Revert failed', success: false };
    }
  }

  /** Move one or more files/folders within a directory on a remote device. */
  async moveProjectFiles(params: {
    deviceId: string;
    items: DeviceMoveProjectFileItem[];
    timeout?: number;
    userId: string;
    workingDirectory: string;
  }): Promise<DeviceMoveProjectFileResultItem[]> {
    const { userId, deviceId, items, workingDirectory, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) throw new Error('Device gateway not configured');

    assertPathsWithinWorkspace(
      workingDirectory,
      items.flatMap((item) => [item.oldPath, item.newPath]),
    );

    const result = await client.invokeRpc<DeviceMoveProjectFileResultItem[]>(
      { deviceId, timeout, userId },
      { method: 'moveLocalFiles', params: { items } },
    );

    if (!result.success || !result.data) {
      log('moveProjectFiles: failed for deviceId=%s — %s', deviceId, result.error);
      throw new Error(result.error || 'Move failed');
    }

    return result.data;
  }

  /** Rename a single file/folder in a directory on a remote device. */
  async renameProjectFile(params: {
    deviceId: string;
    newName: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
  }): Promise<DeviceRenameProjectFileResult> {
    const { userId, deviceId, path, newName, workingDirectory, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) throw new Error('Device gateway not configured');

    // The rename stays in the same directory (the device rejects separators in
    // `newName`), so containing the source path also contains the target.
    assertPathsWithinWorkspace(workingDirectory, [path]);

    const result = await client.invokeRpc<DeviceRenameProjectFileResult>(
      { deviceId, timeout, userId },
      { method: 'renameLocalFile', params: { newName, path } },
    );

    if (!result.success || !result.data) {
      log('renameProjectFile: failed for deviceId=%s — %s', deviceId, result.error);
      throw new Error(result.error || 'Rename failed');
    }

    return result.data;
  }

  /** Save edited content back to a file on a remote device. */
  async writeProjectFile(params: {
    content: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
  }): Promise<DeviceWriteProjectFileResult> {
    const { userId, deviceId, path, content, workingDirectory, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) throw new Error('Device gateway not configured');

    assertPathsWithinWorkspace(workingDirectory, [path]);

    const result = await client.invokeRpc<DeviceWriteProjectFileResult>(
      { deviceId, timeout, userId },
      { method: 'writeLocalFile', params: { content, path } },
    );

    if (!result.success || !result.data) {
      log('writeProjectFile: failed for deviceId=%s — %s', deviceId, result.error);
      throw new Error(result.error || 'Write failed');
    }

    return result.data;
  }

  /**
   * Check whether a path exists on the device and is a directory, via the same
   * generic `invokeRpc` channel as the git reads. Lets a web / remote client
   * validate a manually-entered working directory before binding it. Returns
   * `undefined` when the gateway is unconfigured or the device is unreachable
   * (the caller treats "can't verify" as non-blocking).
   */
  async statPath(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<{ exists: boolean; isDirectory: boolean; repoType?: 'git' | 'github' } | undefined> {
    const { userId, deviceId, path, timeout = 8000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<{
        exists: boolean;
        isDirectory: boolean;
        repoType?: 'git' | 'github';
      }>({ deviceId, timeout, userId }, { method: 'statPath', params: { path } });

      if (!result.success || !result.data) {
        log('statPath: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('statPath: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  async executeToolCall(
    params: { deviceId: string; userId: string },
    toolCall: { apiName: string; arguments: string; identifier: string },
    timeout = 30_000,
  ): Promise<DeviceToolCallResult> {
    const client = this.getClient();
    if (!client) {
      return {
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      };
    }

    log(
      'executeToolCall: userId=%s, deviceId=%s, tool=%s/%s',
      params.userId,
      params.deviceId,
      toolCall.identifier,
      toolCall.apiName,
    );

    try {
      return await client.executeToolCall(
        { deviceId: params.deviceId, timeout, userId: params.userId },
        toolCall,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('executeToolCall: error — %s', message);
      return { content: `Device tool call error: ${message}`, error: message, success: false };
    }
  }

  private getClient(): GatewayHttpClient | null {
    const url = gatewayEnv.DEVICE_GATEWAY_URL;
    const token = gatewayEnv.DEVICE_GATEWAY_SERVICE_TOKEN;
    if (!url || !token) return null;

    if (!this.client) {
      this.client = new GatewayHttpClient({ gatewayUrl: url, serviceToken: token });
    }
    return this.client;
  }
}

export const deviceGateway = new DeviceGateway();

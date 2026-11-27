import {
  type GetGitBranchDiffPayload,
  type GitAheadBehind,
  type GitBranchDiffPatches,
  type GitBranchInfo,
  type GitBranchListItem,
  type GitCheckoutResult,
  type GitDeleteBranchResult,
  type GitFileRevertResult,
  type GitLinkedPullRequestResult,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteBranchListItem,
  type GitRenameBranchResult,
  type GitWorkingTreeFiles,
  type GitWorkingTreePatches,
  type GitWorkingTreeStatus,
  type GitWorktreeListItem,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * The `git.*` IPC group exposed by the desktop GitController. Declared locally
 * because the published `@lobehub/desktop-ipc-typings` in this fork does not yet
 * carry the git namespace — the renderer-side contract is asserted here so the
 * web build type-checks. On web (the only target that reaches this service via
 * its electron path) the calls are never executed; the device.* RPC transport
 * is used instead (see `@/services/git`).
 */
interface GitIpcServices {
  checkoutGitBranch: (params: {
    branch: string;
    create?: boolean;
    path: string;
  }) => Promise<GitCheckoutResult>;
  deleteGitBranch: (params: { branch: string; path: string }) => Promise<GitDeleteBranchResult>;
  detectRepoType: (dirPath: string) => Promise<'git' | 'github' | undefined>;
  getGitAheadBehind: (dirPath: string) => Promise<GitAheadBehind>;
  getGitBranch: (dirPath: string) => Promise<GitBranchInfo>;
  getGitBranchDiff: (payload: GetGitBranchDiffPayload) => Promise<GitBranchDiffPatches>;
  getGitWorkingTreeFiles: (dirPath: string) => Promise<GitWorkingTreeFiles>;
  getGitWorkingTreePatches: (dirPath: string) => Promise<GitWorkingTreePatches>;
  getGitWorkingTreeStatus: (dirPath: string) => Promise<GitWorkingTreeStatus>;
  getLinkedPullRequest: (params: {
    branch: string;
    path: string;
  }) => Promise<GitLinkedPullRequestResult>;
  listGitBranches: (dirPath: string) => Promise<GitBranchListItem[]>;
  listGitRemoteBranches: (dirPath: string) => Promise<GitRemoteBranchListItem[]>;
  listGitWorktrees: (dirPath: string) => Promise<GitWorktreeListItem[]>;
  pullGitBranch: (params: { path: string }) => Promise<GitPullResult>;
  pushGitBranch: (params: { path: string }) => Promise<GitPushResult>;
  renameGitBranch: (params: {
    from: string;
    path: string;
    to: string;
  }) => Promise<GitRenameBranchResult>;
  revertGitFile: (params: { filePath: string; path: string }) => Promise<GitFileRevertResult>;
}

/**
 * Renderer-side wrapper for the `git.*` IPC group exposed by GitController.
 * Kept separate from ElectronSystemService so that git concerns don't leak
 * back into the system/windows/menu surface.
 */
class ElectronGitService {
  private get ipc(): { git: GitIpcServices } {
    return ensureElectronIpc() as unknown as { git: GitIpcServices };
  }

  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    return this.ipc.git.detectRepoType(dirPath);
  }

  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    return this.ipc.git.getGitBranch(dirPath);
  }

  async getLinkedPullRequest(params: {
    branch: string;
    path: string;
  }): Promise<GitLinkedPullRequestResult> {
    return this.ipc.git.getLinkedPullRequest(params);
  }

  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    return this.ipc.git.listGitBranches(dirPath);
  }

  async listGitRemoteBranches(dirPath: string): Promise<GitRemoteBranchListItem[]> {
    return this.ipc.git.listGitRemoteBranches(dirPath);
  }

  async listGitWorktrees(dirPath: string): Promise<GitWorktreeListItem[]> {
    return this.ipc.git.listGitWorktrees(dirPath);
  }

  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    return this.ipc.git.getGitWorkingTreeStatus(dirPath);
  }

  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    return this.ipc.git.getGitWorkingTreeFiles(dirPath);
  }

  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    return this.ipc.git.getGitWorkingTreePatches(dirPath);
  }

  async getGitBranchDiff(payload: GetGitBranchDiffPayload): Promise<GitBranchDiffPatches> {
    return this.ipc.git.getGitBranchDiff(payload);
  }

  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    return this.ipc.git.getGitAheadBehind(dirPath);
  }

  async checkoutGitBranch(params: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    return this.ipc.git.checkoutGitBranch(params);
  }

  async pullGitBranch(params: { path: string }): Promise<GitPullResult> {
    return this.ipc.git.pullGitBranch(params);
  }

  async pushGitBranch(params: { path: string }): Promise<GitPushResult> {
    return this.ipc.git.pushGitBranch(params);
  }

  async revertGitFile(params: { filePath: string; path: string }): Promise<GitFileRevertResult> {
    return this.ipc.git.revertGitFile(params);
  }

  async renameGitBranch(params: {
    from: string;
    path: string;
    to: string;
  }): Promise<GitRenameBranchResult> {
    return this.ipc.git.renameGitBranch(params);
  }

  async deleteGitBranch(params: { branch: string; path: string }): Promise<GitDeleteBranchResult> {
    return this.ipc.git.deleteGitBranch(params);
  }
}

export const electronGitService = new ElectronGitService();

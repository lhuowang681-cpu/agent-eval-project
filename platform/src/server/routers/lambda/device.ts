import { REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import type { DeviceChannel, DeviceListItem, WorkingDirEntry } from '@lobechat/types';
import { z } from 'zod';

import { DeviceModel } from '@/database/models/device';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deviceGateway } from '@/server/services/deviceGateway';

import { preserveWorkspaceCache } from './deviceWorkingDirs';
import { assertWorkspaceRootApproved } from './deviceWorkspaceGuard';

// Derive the zod enum from the canonical config so new platforms are
// automatically covered without touching this file.
const remotePlatformEnum = z.enum(
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => c.type) as [
    (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'],
    ...(typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'][],
  ],
);

const CAPABILITY_TIMEOUT_MS = 5_000;
const PROFILE_TIMEOUT_MS = 5_000;

const deviceProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { deviceModel: new DeviceModel(ctx.serverDB, ctx.userId), userId: ctx.userId },
  });
});

const workspaceFileInput = z.object({
  deviceId: z.string(),
  workingDirectory: z.string(),
});

/**
 * `deviceProcedure` that additionally requires `workingDirectory` to be an
 * approved workspace root for the device. Builds the guard into the procedure
 * so every file-mutating route inherits it and can never forget the check —
 * see {@link assertWorkspaceRootApproved} for why the check is necessary.
 */
const workspaceFileProcedure = deviceProcedure.input(workspaceFileInput).use(async (opts) => {
  const { deviceId, workingDirectory } = workspaceFileInput.parse(await opts.getRawInput());
  await assertWorkspaceRootApproved(opts.ctx.deviceModel, deviceId, workingDirectory);
  return opts.next();
});

export const deviceRouter = router({
  /**
   * Probe whether a specific agent platform (openclaw / hermes) is available
   * on the given device. Dispatches a `checkPlatformCapability` tool call to
   * the device via the gateway and waits up to 5 s for a response.
   */
  checkCapability: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        { deviceId: input.deviceId, userId: ctx.userId },
        {
          apiName: 'checkPlatformCapability',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        CAPABILITY_TIMEOUT_MS,
      );

      if (!result.success) {
        return { available: false, reason: result.error ?? 'Device tool call failed' };
      }

      try {
        return JSON.parse(result.content) as {
          available: boolean;
          reason?: string;
          version?: string;
        };
      } catch {
        return { available: false, reason: 'Invalid response from device' };
      }
    }),

  checkoutGitBranch: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        create: z.boolean().optional(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.checkoutGitBranch({
        branch: input.branch,
        create: input.create,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      }),
    ),

  deleteGitBranch: deviceProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.deleteGitBranch({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      }),
    ),

  /**
   * Fetch the agent profile (title, description, avatar) from the platform
   * installed on the given device. Used to pre-fill the creation modal.
   */
  getAgentProfile: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        { deviceId: input.deviceId, userId: ctx.userId },
        {
          apiName: 'getAgentProfile',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        PROFILE_TIMEOUT_MS,
      );

      if (!result.success) return {};

      try {
        return JSON.parse(result.content) as {
          avatar?: string;
          description?: string;
          title?: string;
        };
      } catch {
        return {};
      }
    }),

  getDeviceSystemInfo: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      return deviceGateway.queryDeviceSystemInfo(ctx.userId, input.deviceId);
    }),

  getGitBranchDiff: deviceProcedure
    .input(z.object({ baseRef: z.string().optional(), deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitBranchDiff({
        baseRef: input.baseRef,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  getGitWorkingTreeFiles: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreeFiles({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  getGitWorkingTreePatches: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreePatches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  /**
   * Read-only local file preview for a file on a remote device. The web client
   * receives render data, not a `localfile://` URL; saving remains unsupported.
   */
  getLocalFilePreview: workspaceFileProcedure
    .input(
      z.object({
        accept: z.enum(['image']).optional(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return deviceGateway.getLocalFilePreview({
        accept: input.accept,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workingDirectory: input.workingDirectory,
      });
    }),

  getProjectFileIndex: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getProjectFileIndex({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  /**
   * Granular git reads for a directory on a remote device, each via its own
   * device RPC so the web/remote git status bar mirrors the local desktop's
   * separate, differently-cadenced SWR hooks. Return `null` when offline / the
   * directory isn't a git repo.
   */
  gitAheadBehind: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitAheadBehind({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  gitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  gitLinkedPullRequest: deviceProcedure
    .input(z.object({ branch: z.string(), deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitLinkedPullRequest({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  gitWorkingTreeStatus: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitWorkingTreeStatus({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  listGitBranches: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? [];
    }),

  listGitRemoteBranches: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitRemoteBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? [];
    }),

  listGitWorktrees: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitWorktrees({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? [];
    }),

  /**
   * All devices the user has ever registered (incl. offline). A device is keyed
   * by its `deviceId`; the gateway's live WS sessions are surfaced as `channels`
   * nested under their device. A union of DB rows and online-only "ghosts" so a
   * currently-reachable device is never lost during rollout.
   */
  listDevices: deviceProcedure.query(async ({ ctx }): Promise<DeviceListItem[]> => {
    const [registered, onlineList] = await Promise.all([
      ctx.deviceModel.query(),
      deviceGateway.queryDeviceList(ctx.userId),
    ]);

    // The gateway returns one flat attachment per live connection; synthesize a
    // single channel per online device for the UI-facing shape.
    const channelsByDevice = new Map<string, DeviceChannel[]>();
    for (const conn of onlineList) {
      channelsByDevice.set(conn.deviceId, [
        {
          channel: null,
          connectedAt: conn.lastSeen,
          hostname: conn.hostname ?? null,
          platform: conn.platform ?? null,
        },
      ]);
    }

    const seen = new Set<string>();

    const fromDb = registered.map((d) => {
      seen.add(d.deviceId);
      const channels = channelsByDevice.get(d.deviceId) ?? [];
      const live = channels[0];
      return {
        channels,
        defaultCwd: d.defaultCwd,
        deviceId: d.deviceId,
        friendlyName: d.friendlyName,
        hostname: d.hostname ?? live?.hostname ?? null,
        identitySource: d.identitySource,
        lastSeen: d.lastSeenAt.toISOString(),
        online: channels.length > 0,
        platform: d.platform ?? live?.platform ?? null,
        registered: true,
        workingDirs: d.workingDirs ?? [],
      };
    });

    // Online but not yet persisted — transient until the client auto-registers.
    const ghosts = [...channelsByDevice.entries()]
      .filter(([deviceId]) => !seen.has(deviceId))
      .map(([deviceId, channels]) => ({
        channels,
        defaultCwd: null,
        deviceId,
        friendlyName: null,
        hostname: channels[0]?.hostname ?? null,
        identitySource: null,
        lastSeen: channels[0]?.connectedAt ?? new Date().toISOString(),
        online: true,
        platform: channels[0]?.platform ?? null,
        registered: false,
        workingDirs: [] as WorkingDirEntry[],
      }));

    return [...fromDb, ...ghosts];
  }),

  /**
   * Project skills (`.agents/skills` / `.claude/skills`) for a directory on a
   * remote device. Returns `null` when offline.
   */
  listProjectSkills: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listProjectSkills({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  /** Move files/folders within a directory on a remote device. */
  moveProjectFiles: workspaceFileProcedure
    .input(
      z.object({
        items: z.array(z.object({ newPath: z.string(), oldPath: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.moveProjectFiles({
        deviceId: input.deviceId,
        items: input.items,
        userId: ctx.userId,
        workingDirectory: input.workingDirectory,
      });
    }),

  pullGitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pullGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      }),
    ),

  pushGitBranch: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pushGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      }),
    ),

  /**
   * Auto-register the calling device (desktop after OIDC login / CLI on first
   * connect). Upserts on (userId, deviceId); user-owned fields are preserved.
   */
  register: deviceProcedure
    .input(
      z.object({
        deviceId: z.string().min(1).max(64),
        hostname: z.string().nullable().optional(),
        identitySource: z.enum(['machine-id', 'fallback']),
        platform: z.string().max(20).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.deviceModel.register(input);
    }),

  removeDevice: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.deviceModel.delete(input.deviceId);
      return { success: true };
    }),

  /** Rename a single file/folder in a directory on a remote device. */
  renameGitBranch: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        from: z.string(),
        path: z.string(),
        to: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.renameGitBranch({
        deviceId: input.deviceId,
        from: input.from,
        path: input.path,
        to: input.to,
        userId: ctx.userId,
      }),
    ),

  renameProjectFile: workspaceFileProcedure
    .input(
      z.object({
        newName: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.renameProjectFile({
        deviceId: input.deviceId,
        newName: input.newName,
        path: input.path,
        userId: ctx.userId,
        workingDirectory: input.workingDirectory,
      });
    }),

  /** Revert a single file in a directory on a remote device. */
  revertGitFile: deviceProcedure
    .input(z.object({ deviceId: z.string(), filePath: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.revertGitFile({
        deviceId: input.deviceId,
        filePath: input.filePath,
        path: input.path,
        userId: ctx.userId,
      }),
    ),

  /**
   * Check whether a path exists on a remote device and is a directory, via the
   * device's `statPath` RPC. Lets a web client validate a manually-entered
   * working directory before binding it. Returns `null` when unreachable.
   */
  statPath: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.statPath({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      return result ?? null;
    }),

  status: deviceProcedure.query(async ({ ctx }) => {
    return deviceGateway.queryDeviceStatus(ctx.userId);
  }),

  /** User-editable fields only — never the machine-reported identity columns. */
  updateDevice: deviceProcedure
    .input(
      z.object({
        defaultCwd: z.string().nullable().optional(),
        deviceId: z.string(),
        friendlyName: z.string().max(100).nullable().optional(),
        workingDirs: z
          .array(z.object({ path: z.string(), repoType: z.enum(['git', 'github']).optional() }))
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { deviceId, workingDirs, ...value } = input;

      // The workspace-init cache (workspace / workspaceScannedAt) is stripped
      // from `workingDirs` by the strict schema above, so re-attach it from the
      // stored row by path — otherwise an ordinary cwd save wipes the cache.
      const nextWorkingDirs = workingDirs
        ? preserveWorkspaceCache(
            workingDirs,
            (await ctx.deviceModel.findByDeviceId(deviceId))?.workingDirs ?? [],
          )
        : undefined;

      await ctx.deviceModel.update(deviceId, { ...value, workingDirs: nextWorkingDirs });
      return { success: true };
    }),

  /** Save edited content back to a file on a remote device. */
  writeProjectFile: workspaceFileProcedure
    .input(
      z.object({
        content: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.writeProjectFile({
        content: input.content,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workingDirectory: input.workingDirectory,
      });
    }),
});

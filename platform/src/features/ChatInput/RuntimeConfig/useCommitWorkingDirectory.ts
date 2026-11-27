import type { WorkingDirEntry } from '@lobechat/types';
import { useCallback } from 'react';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

/**
 * Unified working-directory writes, shared by the directory picker for both
 * local and remote runs. Write rules:
 *
 * - **active topic** → `topic.metadata.workingDirectory` (per-topic override)
 * - **no topic yet** → `agencyConfig.workingDirByDevice[targetDeviceId]`
 * - **always**       → upsert the target device's `workingDirs` recent list
 *
 * Clearing writes an empty string rather than `undefined`: the store/server
 * merge skips `undefined` source values (so a `undefined` would be dropped and
 * the old path survive), while an empty string is a defined value that
 * overwrites and reads as falsy everywhere — `resolveAgentWorkingDirectory`'s
 * `||` chain treats it as "not set" and falls through to the next level.
 */
export const useCommitWorkingDirectory = (agentId: string) => {
  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );
  const legacyAgentWorkingDirectory = useAgentStore((s) =>
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s),
  );
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const updateAgentRuntimeEnvConfigById = useAgentStore((s) => s.updateAgentRuntimeEnvConfigById);

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);

  const writeCwd = useCallback(
    async (newPath: string | undefined, entry?: WorkingDirEntry) => {
      // Topic override wins once a conversation exists; otherwise persist the
      // agent's per-device choice so a new topic inherits it.
      if (activeTopicId) {
        await updateTopicMetadata(activeTopicId, { workingDirectory: newPath ?? '' });
      } else {
        if (targetDeviceId) {
          const prev = agencyConfig?.workingDirByDevice ?? {};
          const nextMap: Record<string, string> = { ...prev, [targetDeviceId]: newPath ?? '' };
          await updateAgentConfigById(agentId, { agencyConfig: { workingDirByDevice: nextMap } });
        }
        // Clearing the agent default must also drop the legacy single-level value,
        // else it keeps re-supplying a stale cwd from a lower precedence level.
        if (!newPath && legacyAgentWorkingDirectory) {
          await updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: '' });
        }
      }
      // Record on the target device's recent list (not its default — a per-agent
      // pick shouldn't repoint other agents on the same device).
      if (newPath && entry && targetDeviceId) {
        await updateDeviceCwd(targetDeviceId, { ...entry, path: newPath }, { setDefault: false });
      }
    },
    [
      agentId,
      agencyConfig,
      activeTopicId,
      targetDeviceId,
      legacyAgentWorkingDirectory,
      updateAgentConfigById,
      updateAgentRuntimeEnvConfigById,
      updateTopicMetadata,
      updateDeviceCwd,
    ],
  );

  const commit = useCallback(
    async (entry: WorkingDirEntry) => {
      const newPath = entry.path.trim();
      if (!newPath) return;
      await writeCwd(newPath, entry);
    },
    [writeCwd],
  );

  const clear = useCallback(async () => {
    await writeCwd(undefined);
  }, [writeCwd]);

  return { clear, commit };
};

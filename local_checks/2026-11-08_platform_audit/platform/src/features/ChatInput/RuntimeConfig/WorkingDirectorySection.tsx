'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

import GitStatus from './GitStatus';
import { useRepoType } from './useRepoType';
import WorkingDirectory from './WorkingDirectory';

interface WorkingDirectorySectionProps {
  agentId: string;
}

/**
 * Working directory picker + git status, shared by the local and bound-device
 * targets. The picker handles local and remote alike; git status shows for
 * both — the local machine probes its own filesystem (IPC), a remote device
 * answers over RPC via GitStatus's `deviceId`.
 */
const WorkingDirectorySection = memo<WorkingDirectorySectionProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const effectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId);
  // Local machine probes the filesystem for repoType (IPC); a remote device's
  // repoType comes from the cached `workingDirs` entry — `useRepoType` handles
  // both via the `deviceId` argument.
  const repoType = useRepoType(
    effectiveWorkingDirectory,
    isLocalDevice ? undefined : targetDeviceId,
  );

  return (
    <>
      <WorkingDirectory agentId={agentId} />
      {effectiveWorkingDirectory && (
        <GitStatus
          deviceId={isLocalDevice ? undefined : targetDeviceId}
          isGithub={repoType === 'github'}
          path={effectiveWorkingDirectory}
        />
      )}
    </>
  );
});

WorkingDirectorySection.displayName = 'WorkingDirectorySection';

export default WorkingDirectorySection;

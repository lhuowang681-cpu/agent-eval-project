import { isDesktop } from '@lobechat/const';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

import { MainToken } from '../ActionBar/Token';
import { useAgentId } from '../hooks/useAgentId';
import ApprovalMode from './ApprovalMode';
import ExecutionDeviceSwitcher from './ExecutionDeviceSwitcher';
import WorkingDirectorySection from './WorkingDirectorySection';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    height: 28px;
    padding-block: 0;
    padding-inline: 4px;
  `,
  // Left cluster (device selector + working directory + git) is variable-width:
  // it shrinks first, then scrolls horizontally instead of wrapping. Scrollbar
  // hidden — trackpad / wheel still works.
  leftGroup: css`
    scrollbar-width: none;
    overflow: auto hidden;
    flex: 1;
    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  // Right cluster (approval mode) stays pinned.
  rightGroup: css`
    flex: none;
  `,
}));

/**
 * Chat-input bottom bar: execution device selector + (machine-scoped) working
 * directory & git on the left, approval mode on the right. Aligned with
 * lobehub's `ControlBar` minus the chat/agent mode switch and hetero branches.
 */
const RuntimeConfig = memo(() => {
  const agentId = useAgentId();
  // Populate this machine's gateway identity on the chat page so the
  // local-device check (working-dir picker, device row badge) resolves.
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();

  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );

  // Skeleton placeholder to prevent layout jump during loading
  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 64, width: 64 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
      </Flexbox>
    );
  }

  const executionTarget = agencyConfig?.executionTarget ?? (isDesktop ? 'local' : 'none');
  const boundDeviceId = agencyConfig?.boundDeviceId;
  // Working dir + git only make sense for a concrete machine: this desktop
  // (local) or a bound device. auto / sandbox / none have no fixed cwd. On web
  // there is no `local`, so only a bound remote device shows the directory.
  const showWorkspace =
    executionTarget === 'local' || (executionTarget === 'device' && !!boundDeviceId);

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Flexbox horizontal align={'center'} className={styles.leftGroup} gap={4}>
        <ExecutionDeviceSwitcher agentId={agentId} />
        {showWorkspace && <WorkingDirectorySection agentId={agentId} />}
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.rightGroup} gap={4}>
        <ApprovalMode />
        <MainToken />
      </Flexbox>
    </Flexbox>
  );
});

RuntimeConfig.displayName = 'RuntimeConfig';

export default RuntimeConfig;

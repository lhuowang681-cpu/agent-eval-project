'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  LaptopIcon,
  MonitorOffIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { executionTargetToRuntimeMode, resolveExecutionTarget } from '@/helpers/executionTarget';
import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { getDeviceIcon } from './getDeviceIcon';

/** Shared SWR key so the switcher and the working-dir section dedupe one request. */
export const RUNTIME_DEVICES_SWR_KEY = 'runtime-devices';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  buttonLabel: css`
    overflow: hidden;
    max-width: 120px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  desc: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  dotOffline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotOnline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 2px ${cssVar.colorSuccessBg};
  `,
  empty: css`
    padding-block: 8px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  header: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px 4px;
    padding-inline: 8px;
  `,
  headerInfo: css`
    cursor: help;
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  headerTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  optionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
  optionMeta: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  optionTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tag: css`
    flex: none;

    padding-block: 0;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
}));

interface OptionRowProps {
  active: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tag?: ReactNode;
}

const OptionRow = memo<OptionRowProps>(({ active, desc, disabled, icon, label, onClick, tag }) => (
  <div
    className={cx(styles.option, active && styles.optionActive, disabled && styles.optionDisabled)}
    onClick={() => {
      if (!disabled) onClick();
    }}
  >
    <div className={styles.optionIcon}>{icon}</div>
    <div className={styles.optionMeta}>
      <Flexbox horizontal align={'center'} gap={6}>
        <span className={styles.optionTitle}>{label}</span>
        {tag ? <span className={styles.tag}>{tag}</span> : null}
      </Flexbox>
      {desc ? <div className={styles.desc}>{desc}</div> : null}
    </div>
    {active ? <Icon className={styles.check} icon={CheckIcon} size={14} /> : null}
  </div>
));

OptionRow.displayName = 'ExecutionDeviceSwitcher.OptionRow';

interface ExecutionDeviceSwitcherProps {
  agentId: string;
}

/**
 * The one execution-target picker for the chat-input bar: no device / auto /
 * this machine (local) / cloud sandbox / one row per registered device. Ported
 * from lobehub's `HeteroDeviceSwitcher` minus all heterogeneous-agent branches.
 *
 * Selecting writes `agencyConfig.executionTarget` (+ `boundDeviceId`) and keeps
 * the legacy per-platform `runtimeMode` tool gate in sync. `local` binds this
 * desktop's own deviceId so a later run can route to it through the gateway.
 */
const ExecutionDeviceSwitcher = memo<ExecutionDeviceSwitcherProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const boundDeviceId = agencyConfig?.boundDeviceId;
  // Cloud sandbox availability (`cloud_sandbox` flag, off via `FEATURE_FLAGS=-cloud_sandbox`).
  // Only an explicit `false` disables it; a missing field (e.g. an older backend
  // whose `config.getGlobalConfig` response has no `enableCloudSandbox`) must
  // default to ON, otherwise the sandbox option/target is hidden by accident.
  const sandboxEnabled = useServerConfigStore(
    (s) => featureFlagsSelectors(s).enableCloudSandbox !== false,
  );
  // Resolve the EFFECTIVE target (platform coercions applied) instead of the raw
  // stored value. `executionTarget` is global agencyConfig synced across clients,
  // so a desktop `local` selection lands on web too — but web has no local
  // filesystem, so it must resolve to `sandbox` rather than show "this machine".
  const executionTarget: DeviceExecutionTarget = resolveExecutionTarget(agencyConfig, {
    isDesktop,
    sandboxEnabled,
  });

  const { data: devices, isLoading } = useClientDataSWR(RUNTIME_DEVICES_SWR_KEY, () =>
    deviceService.listDevices(),
  );

  // This machine's gateway deviceId — badges the matching row as "this device"
  // and is bound when the user picks `local`.
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  const handleSelect = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      setOpen(false);
      const platform = isDesktop ? 'desktop' : 'web';
      let nextBoundDeviceId = target === 'device' ? deviceId : boundDeviceId;
      if (target === 'local') {
        nextBoundDeviceId = currentDeviceId;
        if (!nextBoundDeviceId) {
          try {
            nextBoundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
          } catch {
            nextBoundDeviceId = undefined;
          }
        }
      }
      await updateAgentConfigById(agentId, {
        agencyConfig: {
          executionTarget: target,
          ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
        },
        // Keep the legacy per-platform runtimeMode (client tool gate) in sync.
        chatConfig: {
          runtimeEnv: { runtimeMode: { [platform]: executionTargetToRuntimeMode(target) } },
        },
      });
    },
    [agentId, boundDeviceId, currentDeviceId, updateAgentConfigById],
  );

  const deviceRows = devices ?? [];
  const boundDevice =
    executionTarget === 'device' ? deviceRows.find((d) => d.deviceId === boundDeviceId) : undefined;
  const currentDevice = deviceRows.find((d) => d.deviceId === currentDeviceId);
  const hasNoDevices = deviceRows.length === 0;

  const isActive = (target: DeviceExecutionTarget, deviceId?: string) => {
    if (target === 'device') return executionTarget === 'device' && boundDeviceId === deviceId;
    return executionTarget === target;
  };

  // Chip (current selection)
  let chipIcon: ReactNode = <Icon icon={BoxIcon} size={14} />;
  let chipLabel = t('runtimeEnv.mode.cloud');
  if (executionTarget === 'none') {
    chipIcon = <Icon icon={MonitorOffIcon} size={14} />;
    chipLabel = t('runtimeEnv.mode.none');
  } else if (executionTarget === 'local') {
    chipIcon = currentDevice ? (
      getDeviceIcon(currentDevice.platform)
    ) : (
      <Icon icon={LaptopIcon} size={14} />
    );
    chipLabel =
      currentDevice?.friendlyName || currentDevice?.hostname || t('runtimeEnv.mode.local');
  } else if (executionTarget === 'device') {
    chipIcon = getDeviceIcon(boundDevice?.platform);
    chipLabel = boundDevice?.friendlyName || boundDevice?.hostname || t('runtimeEnv.mode.device');
  }

  const renderDeviceStatus = (d: (typeof deviceRows)[number]) => (
    <>
      <span className={d.online ? styles.dotOnline : styles.dotOffline} />
      <span>{d.online ? t('runtimeEnv.device.online') : t('runtimeEnv.device.offline')}</span>
    </>
  );

  const content = (
    <Flexbox gap={6} style={{ maxWidth: 320, minWidth: 280 }}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('runtimeEnv.title')}</span>
        <Tooltip title={t('runtimeEnv.infoTooltip')}>
          <span className={styles.headerInfo}>
            <Icon icon={InfoIcon} size={12} />
          </span>
        </Tooltip>
      </div>

      <OptionRow
        active={isActive('none')}
        desc={t('runtimeEnv.mode.noneDesc')}
        icon={<Icon icon={MonitorOffIcon} size={14} />}
        label={t('runtimeEnv.mode.none')}
        onClick={() => void handleSelect('none')}
      />
      {isDesktop ? (
        <OptionRow
          active={isActive('local')}
          desc={t('runtimeEnv.mode.localProcessDesc')}
          tag={t('runtimeEnv.mode.localTag')}
          icon={
            currentDevice ? (
              getDeviceIcon(currentDevice.platform)
            ) : (
              <Icon icon={LaptopIcon} size={14} />
            )
          }
          label={
            currentDevice?.friendlyName || currentDevice?.hostname || t('runtimeEnv.mode.local')
          }
          onClick={() => void handleSelect('local')}
        />
      ) : null}
      {sandboxEnabled ? (
        <OptionRow
          active={isActive('sandbox')}
          desc={t('runtimeEnv.mode.cloudDesc')}
          icon={<Icon icon={BoxIcon} size={14} />}
          label={t('runtimeEnv.mode.cloud')}
          onClick={() => void handleSelect('sandbox')}
        />
      ) : null}
      {deviceRows.map((d) => (
        <OptionRow
          active={isActive('device', d.deviceId)}
          disabled={!d.online}
          icon={getDeviceIcon(d.platform)}
          key={d.deviceId}
          label={d.friendlyName || d.hostname || d.deviceId}
          tag={d.deviceId === currentDeviceId ? t('runtimeEnv.mode.gateway') : undefined}
          desc={
            d.deviceId === currentDeviceId
              ? t('runtimeEnv.mode.gatewayDesc')
              : renderDeviceStatus(d)
          }
          onClick={() => void handleSelect('device', d.deviceId)}
        />
      ))}
      {hasNoDevices && isLoading ? (
        <div className={styles.empty}>{t('runtimeEnv.device.loading')}</div>
      ) : null}
      {hasNoDevices && !isLoading ? (
        <div className={styles.empty}>{t('runtimeEnv.device.empty')}</div>
      ) : null}
    </Flexbox>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement="topLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div className={styles.button}>
        {chipIcon}
        <span className={styles.buttonLabel}>{chipLabel}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

ExecutionDeviceSwitcher.displayName = 'ExecutionDeviceSwitcher';

export default ExecutionDeviceSwitcher;

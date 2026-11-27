import { isDesktop } from '@lobechat/const';
import { cssVar } from 'antd-style';
import { Cloud, CloudOff, Lock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { isServerSideTarget } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import Action from '../components/Action';
import Controls from './Controls';

/**
 * Agent Gateway toggle.
 *
 * Mirrors lobehub's "Agent Gateway" switch: an icon button whose popover shows
 * the brand name + Beta tag + description and an on/off chooser (TripYoYo's
 * Search/Memory popover idiom, since TripYoYo has no consolidated "+" menu).
 * Only rendered when the deployment enables gateway mode (server config
 * `agentGatewayUrl` + `enableGatewayMode`).
 *
 * Routing priority is `executionTarget` > `isGatewayMode` > `client` (see
 * `selectRuntimeType`). A device / auto target forces the gateway on regardless
 * of this toggle, so when one is selected the button shows a locked "set by
 * execution target" state — turning it off would just be ignored, and showing
 * an editable "off" would contradict the actual run path. `sandbox` does NOT
 * lock the toggle: it runs as a builtin tool reachable from the client runtime,
 * so the gateway stays freely on/off (mirrors lobehub).
 */
const GatewayMode = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isMobile = useIsMobile();

  // FEATURE_FLAGS: 控制 Agent Gateway 图标是否显示（默认显示）
  const showAgentGatewayIcon = useServerConfigStore((s) => s.featureFlags.showAgentGatewayIcon);

  const enableGatewayMode = useServerConfigStore(
    (s) => !!s.serverConfig.agentGatewayUrl && !!s.serverConfig.enableGatewayMode,
  );

  const isLoading = useAgentStore((s) => agentByIdSelectors.isAgentConfigLoadingById(agentId)(s));
  const disableGatewayMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).disableGatewayMode,
  );
  const defaultDisableGatewayMode = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode,
  );
  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );

  // FEATURE_FLAGS 关闭 → 隐藏图标
  if (!showAgentGatewayIcon) return null;

  // Server hasn't configured the gateway → the toggle is meaningless, hide it.
  if (!enableGatewayMode) return null;

  // Default OFF: enabled only when explicitly turned on (`disableGatewayMode === false`).
  const isEnabled = (disableGatewayMode ?? defaultDisableGatewayMode) === false;

  // A device / auto execution target forces the gateway on (server-only
  // dispatch). The toggle can't turn that off, so show a locked state instead of
  // an editable "off" that would misrepresent the actual run path. `sandbox` is
  // not server-only (runs as a client-reachable builtin tool), so it leaves the
  // toggle editable.
  const effectiveTarget = resolveExecutionTarget(agencyConfig, { isDesktop });
  const isForcedByTarget = isServerSideTarget(effectiveTarget);

  if (isLoading) return <Action disabled icon={CloudOff} />;

  if (isForcedByTarget) {
    return (
      <Action
        color={cssVar.colorInfo}
        icon={Lock}
        showTooltip={false}
        title={t('gatewayMode.titleForced')}
        popover={{
          content: <Controls forcedByTarget />,
          maxWidth: 340,
          minWidth: 340,
          placement: 'topLeft',
          styles: {
            content: {
              padding: 4,
            },
          },
          trigger: isMobile ? 'click' : 'hover',
        }}
      />
    );
  }

  return (
    <Action
      color={isEnabled ? cssVar.colorInfo : undefined}
      icon={isEnabled ? Cloud : CloudOff}
      showTooltip={false}
      title={t(isEnabled ? 'gatewayMode.titleOn' : 'gatewayMode.titleOff')}
      popover={{
        content: <Controls />,
        maxWidth: 340,
        minWidth: 340,
        placement: 'topLeft',
        styles: {
          content: {
            padding: 4,
          },
        },
        trigger: isMobile ? 'click' : 'hover',
      }}
      onClick={
        isMobile
          ? undefined
          : async (e) => {
              e?.preventDefault?.();
              e?.stopPropagation?.();
              // checked → disableGatewayMode: false; unchecked → true
              await updateAgentChatConfig({ disableGatewayMode: isEnabled });
            }
      }
    />
  );
});

GatewayMode.displayName = 'GatewayMode';

export default GatewayMode;

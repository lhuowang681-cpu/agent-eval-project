import { isDesktop } from '@lobechat/const';

import {
  resolveAgentWorkingDirectory,
  resolveTargetDeviceId,
  scratchWorkingDirectory,
} from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Resolve the agent's effective working directory from the current store
 * state (non-hook variant — safe to call from store actions, selectors, and
 * other non-React contexts).
 *
 * Precedence:
 *
 *   topic override > agent's per-device choice > legacy single-level value >
 *   device default > home (desktop only).
 *
 * Combines the agent store (agencyConfig + legacy runtimeEnv dir), chat store
 * (topic cwd), device store (defaultCwd) and the current machine's deviceId.
 * Use this instead of the old `topicCwd || agentCwd` pattern so local and
 * remote resolve the same way. Returns `undefined` only when nothing is set
 * and the desktop context has no home path.
 *
 * NOTE: only reads state — does not trigger device fetch. Callers in React
 * should prefer the {@link useEffectiveWorkingDirectory} hook so the device
 * store is hydrated first.
 */
export const getEffectiveWorkingDirectory = (agentId?: string): string | undefined => {
  const agentState = useAgentStore.getState();
  const agencyConfig = agentId
    ? agentSelectors.getAgentConfigById(agentId)(agentState)?.agencyConfig
    : undefined;
  const legacyAgentWorkingDirectory = agentId
    ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(agentState)
    : undefined;
  const topicWorkingDirectory = topicSelectors.currentTopicWorkingDirectory(
    useChatStore.getState(),
  );
  const currentDeviceId = useElectronStore.getState().gatewayDeviceInfo?.deviceId;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const deviceDefaultCwd = deviceSelectors.getDeviceDefaultCwd(targetDeviceId)(
    useDeviceStore.getState(),
  );

  // `~/Desktop/tripyoyoWork` is the last-resort default, desktop-only
  // (matches the prompt / runtime fallback chain — sandboxes generated
  // artifacts on the Desktop where the user can find them, instead of
  // scattering across the home dir or the app launch dir).
  const ctx = isDesktop ? globalAgentContextManager.getContext() : undefined;
  const fallback = scratchWorkingDirectory(ctx?.desktopPath);

  return resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
  });
};

/**
 * The agent's effective working directory under the unified precedence.
 *
 * Hook variant of {@link getEffectiveWorkingDirectory}. Triggers the device
 * fetch side effect (SWR dedupes by key across all callers) so the device
 * store is hydrated before reading. Devices live behind an authed lambda
 * procedure, so only fetch once signed in (desktop always fetches — it relies
 * on the local device's saved cwd).
 */
export const useEffectiveWorkingDirectory = (agentId?: string): string | undefined => {
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);

  return getEffectiveWorkingDirectory(agentId);
};

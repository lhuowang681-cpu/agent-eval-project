import type { LobeAgentAgencyConfig } from '@lobechat/types';

/**
 * The scratch working directory used when the user hasn't set one: a
 * `tripyoyoWork` folder on the user's Desktop (`<desktop>/tripyoyoWork`).
 * Sandboxes the agent's generated artifacts so they don't scatter across
 * the home directory or the Electron app launch dir (`process.cwd()`), and
 * keeps them somewhere the user can easily find and clean up.
 *
 * Used as the last-resort fallback in the precedence chain — prompt
 * placeholder, client/server runtime state, and the desktop main process's
 * `resolveCwd` all resolve to this same value so the path the model sees
 * matches where files actually land. The directory is created on first use
 * by the desktop main process's `resolveCwd`.
 */
export const scratchWorkingDirectory = (desktopPath?: string): string | undefined =>
  desktopPath ? `${desktopPath}/tripyoyoWork` : undefined;

/**
 * The device a run targets: an explicitly bound remote device, this machine, or
 * (on web) a desktop-local binding synced from the desktop app. Local execution
 * treats the current machine as its own device, so local and remote share one
 * resolution model.
 */
export const resolveTargetDeviceId = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  currentDeviceId: string | undefined,
): string | undefined =>
  agencyConfig?.executionTarget === 'device'
    ? agencyConfig?.boundDeviceId
    : agencyConfig?.executionTarget === 'local'
      ? currentDeviceId || agencyConfig?.boundDeviceId
      : currentDeviceId;

/**
 * Unified working-directory precedence (the client picker and the server run
 * resolve a directory the same way):
 *
 *   topic override
 *     > agent's per-device choice (`agencyConfig.workingDirByDevice[targetDeviceId]`)
 *     > legacy single-level value (`chatConfig.runtimeEnv.workingDirectory`)
 *     > device default (`device.defaultCwd`)
 *     > caller fallback (e.g. home dir for in-process runs)
 *
 * The legacy slot keeps existing selections working until the user next picks a
 * directory (which writes the new per-device map). Pure function — callers pass
 * the already-read values, so it works on both client and server.
 */
export const resolveAgentWorkingDirectory = (params: {
  agencyConfig?: LobeAgentAgencyConfig;
  currentDeviceId?: string;
  deviceDefaultCwd?: string;
  fallback?: string;
  legacyAgentWorkingDirectory?: string;
  topicWorkingDirectory?: string;
}): string | undefined => {
  const {
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
  } = params;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const agentChoice = targetDeviceId
    ? agencyConfig?.workingDirByDevice?.[targetDeviceId]
    : undefined;
  return (
    topicWorkingDirectory ||
    agentChoice ||
    legacyAgentWorkingDirectory ||
    deviceDefaultCwd ||
    fallback ||
    undefined
  );
};

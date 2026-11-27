import { OFFICIAL_URL } from '@lobechat/const';

import { type ElectronState } from '../initialState';

const isSyncActive = (s: ElectronState) => s.dataSyncConfig.active;

const storageMode = (s: ElectronState) => s.dataSyncConfig.storageMode;

/**
 * The cloud server URL this desktop build actually connects to.
 * Injected synchronously by the desktop preload (window.lobeEnv) so it differs
 * correctly between test/prod builds. Falls back to OFFICIAL_URL on web or when
 * the value is unavailable.
 */
const officialCloudServerUrl = (): string => {
  if (typeof window !== 'undefined' && window.lobeEnv?.officialCloudServer) {
    return window.lobeEnv.officialCloudServer;
  }
  return OFFICIAL_URL;
};

/**
 * Returns the effective remote server URL based on storage mode:
 * - Cloud mode: returns the real cloud server URL (so share/login/avatar URLs
 *   point at the actual deployment domain, matching the web app)
 * - SelfHost mode: returns the configured remoteServerUrl
 */
const remoteServerUrl = (s: ElectronState) =>
  s.dataSyncConfig.storageMode === 'cloud'
    ? officialCloudServerUrl()
    : s.dataSyncConfig.remoteServerUrl || '';

/**
 * Returns the raw remoteServerUrl from config without transformation.
 * Use this when you need the original configured value (e.g., for editing forms).
 */
const rawRemoteServerUrl = (s: ElectronState) => s.dataSyncConfig.remoteServerUrl || '';

export const electronSyncSelectors = {
  isSyncActive,
  rawRemoteServerUrl,
  remoteServerUrl,
  storageMode,
};

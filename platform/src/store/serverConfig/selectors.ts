import { DEFAULT_AGENT, DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { UserDefaultAgent, UserSystemAgentConfig } from '@lobechat/types';

import { merge } from '@/utils/merge';

import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

export const serverConfigSelectors = {
  announcement: (s: ServerConfigStore) => s.serverConfig.announcement,
  defaultAgent: (s: ServerConfigStore): UserDefaultAgent =>
    merge(DEFAULT_AGENT, s.serverConfig.defaultAgent),
  systemAgent: (s: ServerConfigStore): UserSystemAgentConfig =>
    merge(DEFAULT_SYSTEM_AGENT_CONFIG, s.serverConfig.systemAgent),
  disablePublicWebPageCrawl: (s: ServerConfigStore) =>
    s.serverConfig.disablePublicWebPageCrawl || false,
  disableEmailPassword: (s: ServerConfigStore) => s.serverConfig.disableEmailPassword || false,
  enableAppDevMode: (s: ServerConfigStore) => s.serverConfig.enableAppDevMode || false,
  enableBusinessFeatures: (s: ServerConfigStore) => s.serverConfig.enableBusinessFeatures || false,
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableKlavis: (s: ServerConfigStore) => s.serverConfig.enableKlavis || false,
  enableLobehubSkill: (s: ServerConfigStore) => s.serverConfig.enableLobehubSkill || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
  visualUnderstanding: (s: ServerConfigStore) => s.serverConfig.visualUnderstanding,
};

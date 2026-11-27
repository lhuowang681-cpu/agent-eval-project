import type { PartialDeep } from 'type-fest';

import type { IFeatureFlagsState } from '@/config/featureFlags';

import type { ChatModelCard } from './llm';
import type {
  GlobalLLMProviderKey,
  UserDefaultAgent,
  UserImageConfig,
  UserSystemAgentConfig,
} from './user/settings';

export type GlobalMemoryLayer = 'activity' | 'context' | 'experience' | 'identity' | 'preference';

export interface MemoryAgentPublicConfig {
  baseURL?: string;
  contextLimit?: number;
  model?: string;
  provider?: string;
}

export interface MemoryLayerExtractorPublicConfig extends MemoryAgentPublicConfig {
  layers?: Partial<Record<GlobalMemoryLayer, string>>;
}

export interface GlobalMemoryExtractionConfig {
  agentGateKeeper: MemoryAgentPublicConfig;
  agentLayerExtractor: MemoryLayerExtractorPublicConfig;
  concurrency?: number;
  embedding?: MemoryAgentPublicConfig;
}

export interface GlobalMemoryConfig {
  userMemory?: GlobalMemoryExtractionConfig;
}

export interface ServerModelProviderConfig {
  enabled?: boolean;
  enabledModels?: string[];
  fetchOnClient?: boolean;
  /**
   * the model lists defined in server
   */
  serverModelLists?: ChatModelCard[];
}

export type ServerLanguageModel = Partial<Record<GlobalLLMProviderKey, ServerModelProviderConfig>>;

export interface VisualUnderstandingConfig {
  model: string;
  provider: string;
}

export type GlobalAnnouncementLevel = 'info' | 'warning';

export interface GlobalAnnouncementConfig {
  enabled?: boolean;
  level?: GlobalAnnouncementLevel;
  message?: string;
  title?: string;
}

export interface GlobalServerConfig {
  /** Agent gateway base URL exposed to the client for heterogeneous-agent reconnects. */
  agentGatewayUrl?: string;
  aiProvider: ServerLanguageModel;
  announcement?: GlobalAnnouncementConfig;
  defaultAgent?: PartialDeep<UserDefaultAgent>;
  disableEmailPassword?: boolean;
  /**
   * When true, public (non-Feishu) web page crawl is disabled server-side; exposed for client system prompts.
   */
  disablePublicWebPageCrawl?: boolean;
  /**
   * App-level dev mode (from ENABLE_APP_DEV_MODE). Unlocks dev-only behaviors such as profile username/email edits.
   */
  enableAppDevMode?: boolean;
  enableBusinessFeatures?: boolean;
  /**
   * @deprecated
   */
  enabledOAuthSSO?: boolean;
  enableEmailVerification?: boolean;
  /**
   * When true (and `agentGatewayUrl` is set), agent runs are dispatched to the
   * server over the Agent Gateway WebSocket instead of running in-process on the
   * client — this is what lets the execution-target choice (sandbox / device /
   * auto) actually change where the agent runs. Gates `isGatewayModeEnabled`.
   */
  enableGatewayMode?: boolean;
  enableKlavis?: boolean;
  enableLobehubSkill?: boolean;
  enableMagicLink?: boolean;
  enableMarketTrustedClient?: boolean;
  enableUploadFileToServer?: boolean;
  image?: PartialDeep<UserImageConfig>;
  memory?: GlobalMemoryConfig;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserSystemAgentConfig>;
  telemetry: {
    langfuse?: boolean;
  };
  visualUnderstanding?: VisualUnderstandingConfig;
}

export interface GlobalRuntimeConfig {
  serverConfig: GlobalServerConfig;
  serverFeatureFlags: IFeatureFlagsState;
}

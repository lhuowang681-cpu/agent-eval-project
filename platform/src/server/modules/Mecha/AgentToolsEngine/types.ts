import { type LobeToolManifest, type PluginEnableChecker } from '@lobechat/context-engine';
import { type LobeAgentAgencyConfig, type LobeTool, type RuntimeEnvConfig } from '@lobechat/types';

import { type ExecutionPlan } from '@/helpers/executionTarget';

/**
 * Installed plugin with manifest
 */
export type InstalledPlugin = LobeTool;

/**
 * Context for server-side tools engine
 */
export interface ServerAgentToolsContext {
  /** Installed plugins from database */
  installedPlugins: InstalledPlugin[];
  /** Whether the model supports tool use (function calling) */
  isModelSupportToolUse: (model: string, provider: string) => boolean;
}

/**
 * Configuration options for createServerToolsEngine
 */
export interface ServerAgentToolsEngineConfig {
  /** Additional manifests to include (e.g., Klavis tools) */
  additionalManifests?: LobeToolManifest[];
  /** Default tool IDs that will always be added */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
}

/**
 * Parameters for createServerAgentToolsEngine
 */
export interface ServerCreateAgentToolsEngineParams {
  /** Additional manifests to include (e.g., TripYoYo Skills) */
  additionalManifests?: LobeToolManifest[];
  /** Agent configuration containing plugins array */
  agentConfig: {
    /**
     * Unified execution selection. Used to derive the effective execution target
     * when no `executionPlan` is supplied (focused sub-agent engines that don't
     * resolve a plan).
     */
    agencyConfig?: LobeAgentAgencyConfig;
    /** Optional agent chat config */
    chatConfig?: {
      runtimeEnv?: RuntimeEnvConfig;
      searchMode?: 'off' | 'on' | 'auto';
    };
    /** Plugin IDs enabled for this agent */
    plugins?: string[];
  };
  /** Device gateway context for remote tool calling */
  deviceContext?: {
    /** When true, a device has been auto-activated — Remote Device tool is unnecessary */
    autoActivated?: boolean;
    boundDeviceId?: string;
    deviceOnline?: boolean;
    gatewayConfigured: boolean;
  };
  /**
   * The run's resolved execution plan (THE single source of truth for where the
   * run executes). Drives the tool gate: `sandbox → cloud tools`, `local →
   * local-system`, `device → gateway`, `none → no run tools`. When omitted, the
   * target is derived from `agentConfig.agencyConfig`.
   */
  executionPlan?: ExecutionPlan;
  /** Force-enable cloud sandbox for large uploaded file processing */
  forceEnableCloudSandbox?: boolean;
  /** Whether the user's global memory setting is enabled */
  globalMemoryEnabled?: boolean;
  /** Whether agent has enabled knowledge bases */
  hasEnabledKnowledgeBases?: boolean;
  /** Model name for function calling compatibility check */
  model: string;
  /** Provider name for function calling compatibility check */
  provider: string;
  /**
   * Whether the cloud sandbox is available (`cloud_sandbox` flag, off via
   * `FEATURE_FLAGS=-cloud_sandbox`). When `false`, the Cloud Sandbox tool is never
   * mounted — not even via `forceEnableCloudSandbox`. Defaults to `true`.
   */
  sandboxEnabled?: boolean;
  /**
   * Builtin tool IDs the user has uninstalled (from user settings). These are
   * forced off — they override agent.plugins[] and system rules so an
   * uninstalled builtin tool never has its manifest sent to the LLM, even if
   * it is still referenced in an older agent's plugins[].
   */
  uninstalledBuiltinTools?: string[];
}

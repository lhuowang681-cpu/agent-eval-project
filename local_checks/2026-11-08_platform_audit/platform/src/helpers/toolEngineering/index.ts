/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { buildWebBrowsingManifest, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { alwaysOnToolIds, defaultToolIds, disabledBuiltinToolIds } from '@lobechat/builtin-tools';
import { createEnableChecker, type PluginEnableChecker } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { type ChatCompletionTool, type LobeBuiltinTool, type WorkingModel } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { isToolAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { getToolStoreState } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: LobeChatPluginManifest[];
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /** Force-enable cloud sandbox for large uploaded file processing */
  forceCloudSandbox?: boolean;
  /** When set, replaces the built-in lobe-web-browsing manifest (e.g. systemRole when public crawl is off). */
  webBrowsingManifestOverride?: LobeChatPluginManifest;
}

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const {
    enableChecker,
    additionalManifests = [],
    defaultToolIds,
    webBrowsingManifestOverride,
  } = config;

  const toolStoreState = getToolStoreState();

  // Get all available plugin manifests
  const pluginManifests = pluginSelectors.installedPluginManifestList(toolStoreState);

  // Get all builtin tool manifests
  const builtinManifests = toolStoreState.builtinTools.map((tool: LobeBuiltinTool) => {
    if (tool.identifier === WebBrowsingManifest.identifier && webBrowsingManifestOverride) {
      return webBrowsingManifestOverride;
    }
    return tool.manifest as LobeChatPluginManifest;
  });

  // Get Klavis tool manifests
  const klavisTools = klavisStoreSelectors.klavisAsLobeTools(toolStoreState);
  const klavisManifests = klavisTools
    .map((tool) => tool.manifest as LobeChatPluginManifest)
    .filter(Boolean);

  // Get TripYoYo Skill tool manifests
  const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
  const lobehubSkillManifests = lobehubSkillTools
    .map((tool) => tool.manifest as LobeChatPluginManifest)
    .filter(Boolean);

  // Combine all manifests
  const allManifests = [
    ...pluginManifests,
    ...builtinManifests,
    ...builtinMcpManifests,
    ...klavisManifests,
    ...lobehubSkillManifests,
    ...additionalManifests,
  ];

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests,
  });
};

export const createAgentToolsEngine = (
  workingModel: WorkingModel,
  /** Runtime-resolved plugin IDs (from agentConfigResolver), may include tools beyond the active agent */
  pluginIds?: string[],
  options?: { forceCloudSandbox?: boolean },
) => {
  const searchConfig = getSearchConfig(workingModel.model, workingModel.provider);
  const agentState = getAgentStoreState();
  const userPlugins = agentSelectors.currentAgentPlugins(agentState);

  // Build platform-specific default tool IDs:
  // Code execution tools (CloudSandbox, LocalSystem) are only available on desktop,
  // never exposed to agents on web runtime.
  const publicWebCrawlDisabled =
    createServerConfigStore().getState().serverConfig.disablePublicWebPageCrawl ?? false;

  // Mirror the server gate: the CloudSandbox tool (and thus its systemRole
  // prompt, which advertises `extract-text` etc.) is only available when the
  // `cloud_sandbox` feature flag is on. When the flag is off
  // (`FEATURE_FLAGS=-cloud_sandbox`), the tool is never enabled — even on the
  // force-enable-for-uploads path — so the LLM never sees sandbox guidance and
  // won't mis-invoke it. Matches `createServerAgentToolsEngine`'s rule.
  const cloudSandboxAvailable =
    createServerConfigStore().getState().featureFlags?.enableCloudSandbox !== false;

  return createToolsEngine({
    defaultToolIds,
    webBrowsingManifestOverride: publicWebCrawlDisabled
      ? (buildWebBrowsingManifest({ publicWebCrawlDisabled: true }) as LobeChatPluginManifest)
      : undefined,
    enableChecker: createEnableChecker({
      allowExplicitActivation: true,
      platformFilter: ({ pluginId }) => {
        const toolStoreState = getToolStoreState();
        const installedPlugin = pluginSelectors.getInstalledPluginById(pluginId)(toolStoreState);

        if (
          !isToolAvailableInCurrentEnv(pluginId, {
            installedPlugins: installedPlugin ? [installedPlugin] : toolStoreState.installedPlugins,
          })
        ) {
          return false;
        }

        return undefined; // fall through to rules
      },
      rules: {
        // Runtime-resolved plugins (from agentConfigResolver for the effective agent,
        // may include sub-agent/group/page scope plugins not on the active agent)
        ...(pluginIds && Object.fromEntries(pluginIds.map((id) => [id, true]))),
        // User-selected plugins (from the active agent)
        ...Object.fromEntries(userPlugins.map((id) => [id, true])),
        // Always-on builtin tools
        ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
        // System-level rules (may override user selection for specific tools)
        [CloudSandboxManifest.identifier]:
          cloudSandboxAvailable &&
          (options?.forceCloudSandbox ||
            agentChatConfigSelectors.isCloudSandboxEnabled(agentState)),
        [KnowledgeBaseManifest.identifier]: agentSelectors.hasEnabledKnowledgeBases(agentState),
        [LocalSystemManifest.identifier]: agentChatConfigSelectors.isLocalSystemEnabled(agentState),
        [MemoryManifest.identifier]:
          agentChatConfigSelectors.currentChatConfig(agentState).memory?.enabled ??
          settingsSelectors.memoryEnabled(useUserStore.getState()),
        [WebBrowsingManifest.identifier]: searchConfig.useApplicationBuiltinSearchTool,
        ...Object.fromEntries(disabledBuiltinToolIds.map((id) => [id, false])),
        // User-uninstalled builtin tools are forced off last so they override
        // plugins[] and any system rule above (an uninstalled tool must never
        // have its manifest sent, even if still referenced in an older plugins[]).
        ...Object.fromEntries(getToolStoreState().uninstalledBuiltinTools.map((id) => [id, false])),
      },
    }),
  });
};

/**
 * Provides the same functionality using ToolsEngine with enhanced capabilities
 *
 * @param toolIds - Array of tool IDs to generate tools for
 * @param model - Model name for function calling compatibility check (optional)
 * @param provider - Provider name for function calling compatibility check (optional)
 * @returns Array of ChatCompletionTool objects
 */
export const getEnabledTools = (
  toolIds: string[] = [],
  model: string,
  provider: string,
): ChatCompletionTool[] => {
  const toolsEngine = createToolsEngine();

  return (
    toolsEngine.generateTools({
      model, // Use provided model or fallback
      provider, // Use provided provider or fallback
      toolIds,
    }) || []
  );
};

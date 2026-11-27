import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { getKlavisServerByServerIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { type RenderDisplayControl } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import {
  isInstalledPluginAvailableInCurrentEnv,
  isToolAvailableInCurrentEnv,
} from '@/helpers/toolAvailability';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { type MetaData } from '@/types/meta';
import { type LobeToolMeta } from '@/types/tool/tool';

import { type ToolStoreState } from '../initialState';
import { builtinToolSelectors } from '../slices/builtin/selectors';
import { KlavisServerStatus } from '../slices/klavisStore';
import { lobehubSkillStoreSelectors } from '../slices/lobehubSkillStore';
import { LobehubSkillStatus } from '../slices/lobehubSkillStore/types';
import { pluginSelectors } from '../slices/plugin/selectors';

const metaList = (s: ToolStoreState): LobeToolMeta[] => {
  const pluginList = pluginSelectors.installedPluginMetaList(s) as LobeToolMeta[];
  const lobehubSkillList = lobehubSkillStoreSelectors.metaList(s) as LobeToolMeta[];

  return builtinToolSelectors.metaList(s).concat(pluginList).concat(lobehubSkillList);
};

const getMetaById =
  (id: string) =>
  (s: ToolStoreState): MetaData | undefined => {
    const item = metaList(s).find((m) => m.identifier === id);

    if (!item) return;

    if (item.meta) return item.meta;

    return {
      avatar: item?.avatar,
      backgroundColor: item?.backgroundColor,
      description: item?.description,
      title: item?.title,
    };
  };

const getManifestById =
  (id: string) =>
  (s: ToolStoreState): LobeChatPluginManifest | undefined =>
    pluginSelectors
      .installedPluginManifestList(s)
      .concat(s.builtinTools.map((b) => b.manifest as LobeChatPluginManifest))
      .concat(builtinMcpManifests as LobeChatPluginManifest[])
      .find((i) => i.identifier === id);

// Get plugin manifest loading status
const getManifestLoadingStatus = (id: string) => (s: ToolStoreState) => {
  const manifest = getManifestById(id)(s);

  if (s.pluginInstallLoading[id]) return 'loading';

  if (!manifest) return 'error';

  if (!!manifest) return 'success';
};

const isToolHasUI = (id: string) => (s: ToolStoreState) => {
  const manifest = getManifestById(id)(s);
  if (!manifest) return false;
  const builtinTool = s.builtinTools.find((tool) => tool.identifier === id);

  if (builtinTool && builtinTool.type === 'builtin') {
    return true;
  }

  return !!manifest.ui;
};

/**
 * Get the renderDisplayControl configuration for a specific tool API
 * Only works for builtin tools, plugins don't support this feature yet
 * @param identifier - Tool identifier
 * @param apiName - API name
 * @returns RenderDisplayControl value, defaults to 'collapsed'
 */
const getRenderDisplayControl =
  (identifier: string, apiName: string) =>
  (s: ToolStoreState): RenderDisplayControl => {
    // Only builtin tools support renderDisplayControl
    const builtinTool = s.builtinTools.find((t) => t.identifier === identifier);
    if (!builtinTool) return 'collapsed';

    const api = builtinTool.manifest.api.find((a) => a.name === apiName);
    return api?.renderDisplayControl ?? 'collapsed';
  };

/**
 * Get the list of required parameter names declared by a builtin tool API's
 * manifest schema. Used to validate tool-call arguments before dispatch, since
 * models occasionally emit empty/partial arguments (e.g. "{}") that would
 * otherwise reach executors and crash with confusing errors.
 * @param identifier - Tool identifier
 * @param apiName - API name
 * @returns required parameter names, or empty array for non-builtin/unknown tools
 */
const getBuiltinApiRequiredParams =
  (identifier: string, apiName: string) =>
  (s: ToolStoreState): string[] => {
    const builtinTool = s.builtinTools.find((t) => t.identifier === identifier);
    if (!builtinTool) return [];

    const api = builtinTool.manifest.api.find((a) => a.name === apiName);
    return api?.parameters?.required ?? [];
  };

export interface AvailableToolForDiscovery {
  description: string;
  identifier: string;
  name: string;
}

/**
 * Get all tools available for tool discovery (activateTools).
 * Built from raw state to avoid inheriting unrelated filtering logic.
 *
 * Sources:
 * 1. Builtin tools (from s.builtinTools) — exclude non-discoverable, skills, platform-unavailable
 * 2. User-installed plugins (from s.installedPlugins) — exclude Klavis/TripYoYo Skill/agent skill overlap
 * 3. Klavis MCP servers (connected) — description from KLAVIS_SERVER_TYPES
 * 4. TripYoYo Skill servers (connected) — description from LOBEHUB_SKILL_PROVIDERS
 */
const availableToolsForDiscovery = (s: ToolStoreState): AvailableToolForDiscovery[] => {
  // Build exclusion sets for deduplication
  const builtinSkillIds = new Set((s.builtinSkills || []).map((skill) => skill.identifier));
  const agentSkillIds = new Set((s.agentSkills || []).map((skill) => skill.identifier));
  const klavisIds = new Set((s.servers || []).map((server) => server.identifier));
  const lobehubSkillIds = new Set((s.lobehubSkillServers || []).map((server) => server.identifier));

  // CloudSandbox is only discoverable (listed in <available_tools>) when the
  // `cloud_sandbox` feature flag is on. When the flag is off, the tool can't
  // run, so advertising it only prompts the LLM to mis-invoke it.
  const cloudSandboxAvailable =
    createServerConfigStore().getState().featureFlags?.enableCloudSandbox !== false;

  // 1. Builtin tools — directly from s.builtinTools
  const builtinItems = s.builtinTools
    .filter((tool) => !s.uninstalledBuiltinTools.includes(tool.identifier))
    .filter((tool) => tool.discoverable !== false)
    .filter((tool) => !builtinSkillIds.has(tool.identifier))
    .filter((tool) => isToolAvailableInCurrentEnv(tool.identifier))
    .filter((tool) => tool.identifier !== CloudSandboxManifest.identifier || cloudSandboxAvailable)
    .map((tool) => ({
      description: tool.manifest.meta?.description || '',
      identifier: tool.identifier,
      name: tool.manifest.meta?.title || tool.identifier,
    }));

  // 2. User-installed plugins — directly from s.installedPlugins
  //    Exclude Klavis, TripYoYo Skill, and agent skill entries (they are handled in dedicated sources)
  const pluginItems = s.installedPlugins
    .filter((p) => !klavisIds.has(p.identifier))
    .filter((p) => !lobehubSkillIds.has(p.identifier))
    .filter((p) => !agentSkillIds.has(p.identifier))
    .filter((p) => !p.customParams?.klavis) // extra safety for Klavis plugins
    .filter((plugin) => isInstalledPluginAvailableInCurrentEnv(plugin))
    .map((plugin) => {
      const meta = plugin.manifest?.meta;
      return {
        description: meta?.description || '',
        identifier: plugin.identifier,
        name: meta?.title || plugin.identifier,
      };
    });

  // 3. Klavis MCP servers (connected only)
  const klavisItems = (s.servers || [])
    .filter((server) => server.status === KlavisServerStatus.CONNECTED && server.tools?.length)
    .map((server) => {
      const config = getKlavisServerByServerIdentifier(server.identifier);
      return {
        description: config?.description || '',
        identifier: server.identifier,
        name: config?.label || server.serverName,
      };
    });

  // 4. TripYoYo Skill servers (connected only)
  const lobehubSkillItems = (s.lobehubSkillServers || [])
    .filter((server) => server.status === LobehubSkillStatus.CONNECTED)
    .map((server) => {
      const config = getLobehubSkillProviderById(server.identifier);
      return {
        description: config?.description || '',
        identifier: server.identifier,
        name: config?.label || server.name,
      };
    });

  // 5. Builtin MCP servers (from code, not in builtinTools store)
  const builtinMcpItems = builtinMcpManifests
    .filter((m) => !s.uninstalledBuiltinTools.includes(m.identifier))
    .filter((m) => isToolAvailableInCurrentEnv(m.identifier))
    .map((m) => ({
      description: m.meta?.description || '',
      identifier: m.identifier,
      name: m.meta?.title || m.identifier,
    }));

  return [
    ...builtinItems,
    ...builtinMcpItems,
    ...pluginItems,
    ...klavisItems,
    ...lobehubSkillItems,
  ];
};

export const toolSelectors = {
  availableToolsForDiscovery,
  getBuiltinApiRequiredParams,
  getManifestById,
  getManifestLoadingStatus,
  getMetaById,
  getRenderDisplayControl,
  isToolHasUI,
  metaList,
};

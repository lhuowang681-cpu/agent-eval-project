import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { alwaysOnToolIds } from '@lobechat/builtin-tools';
import { type BuiltinSkill, type LobeToolMeta } from '@lobechat/types';

import {
  isBuiltinSkillAvailableInCurrentEnv,
  isBuiltinSkillAvailableOnWeb,
  isBuiltinToolAvailableInCurrentEnv,
  isBuiltinToolAvailableOnWeb,
} from '@/helpers/toolAvailability';
import { createServerConfigStore } from '@/store/serverConfig/store';

import { type ToolStoreState } from '../../initialState';
import { agentSkillsSelectors } from '../agentSkills/selectors';
import { KlavisServerStatus } from '../klavisStore';

export interface LobeToolMetaWithAvailability extends LobeToolMeta {
  /**
   * Whether the tool is available in web environment
   * e.g., LocalSystem is desktop-only, so availableInWeb is false
   */
  availableInWeb: boolean;
}

const toBuiltinMeta = (t: ToolStoreState['builtinTools'][number]): LobeToolMeta => ({
  author: 'TripYoYo',
  identifier: t.identifier,
  meta: t.manifest.meta,
  type: 'builtin' as const,
});

const toBuiltinMetaWithAvailability = (
  t: ToolStoreState['builtinTools'][number],
): LobeToolMetaWithAvailability => ({
  ...toBuiltinMeta(t),
  availableInWeb: isBuiltinToolAvailableOnWeb(t.identifier),
});

const toSkillMeta = (s: BuiltinSkill): LobeToolMeta => ({
  author: 'TripYoYo',
  identifier: s.identifier,
  meta: {
    avatar: s.avatar,
    description: s.description,
    title: s.name,
  },
  type: 'builtin' as const,
});

const toSkillMetaWithAvailability = (s: BuiltinSkill): LobeToolMetaWithAvailability => ({
  ...toSkillMeta(s),
  availableInWeb: isBuiltinSkillAvailableOnWeb(s.identifier),
});

const getKlavisMetas = (s: ToolStoreState): LobeToolMeta[] =>
  (s.servers || [])
    .filter((server) => server.status === KlavisServerStatus.CONNECTED && server.tools?.length)
    .map((server) => ({
      author: 'Klavis',
      // Use identifier as storage identifier (e.g., 'google-calendar')
      identifier: server.identifier,
      meta: {
        avatar: '☁️',
        description: `TripYoYo Mcp Server: ${server.serverName}`,
        tags: ['klavis', 'mcp'],
        // title still uses serverName to display friendly name
        title: server.serverName,
      },
      type: 'builtin' as const,
    }));

const getKlavisMetasWithAvailability = (s: ToolStoreState): LobeToolMetaWithAvailability[] =>
  getKlavisMetas(s).map((meta) => ({ ...meta, availableInWeb: true }));

const getBuiltinMcpMetas = (s: ToolStoreState): LobeToolMeta[] =>
  builtinMcpManifests
    .filter((m) => !s.uninstalledBuiltinTools.includes(m.identifier))
    // Platform gate (e.g. Feishu MCP is web-only on desktop)
    .filter((m) => isBuiltinToolAvailableInCurrentEnv(m.identifier))
    .map((m) => ({
      author: 'TripYoYo',
      identifier: m.identifier,
      meta: m.meta,
      type: 'builtin' as const,
    }));

const getBuiltinMcpMetasWithAvailability = (_s: ToolStoreState): LobeToolMetaWithAvailability[] =>
  builtinMcpManifests.map((m) => ({
    author: 'TripYoYo',
    availableInWeb: isBuiltinToolAvailableOnWeb(m.identifier),
    identifier: m.identifier,
    meta: m.meta,
    type: 'builtin' as const,
  }));

/**
 * Get visible builtin tools meta list (excludes hidden tools)
 * Used for general tool display in chat input bar
 * Only returns tools that are not in the uninstalledBuiltinTools list
 */
const metaList = (s: ToolStoreState): LobeToolMeta[] => {
  const { uninstalledBuiltinTools } = s;

  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Filter hidden tools
      if (item.hidden) return false;

      // Filter platform-specific tools (e.g., LocalSystem desktop-only)
      if (!isBuiltinToolAvailableInCurrentEnv(item.identifier)) return false;

      // Exclude uninstalled tools
      if (uninstalledBuiltinTools.includes(item.identifier)) {
        return false;
      }

      return true;
    })
    .map(toBuiltinMeta);

  const skillMetas = (s.builtinSkills || [])
    .filter((skill) => {
      if (!isBuiltinSkillAvailableInCurrentEnv(skill.identifier)) return false;
      if (uninstalledBuiltinTools.includes(skill.identifier)) return false;

      return true;
    })
    .map(toSkillMeta);
  const agentSkillMetas = agentSkillsSelectors.agentSkillMetaList(s);

  return [
    ...skillMetas,
    ...agentSkillMetas,
    ...builtinMetas,
    ...getBuiltinMcpMetas(s),
    ...getKlavisMetas(s),
  ];
};

// Tools that should never be exposed in agent profile configuration
const EXCLUDED_TOOLS = new Set([
  'lobe-agent-builder',
  'lobe-group-agent-builder',
  'lobe-group-management',
  'lobe-skills',
]);

const isCloudSandboxAvailable = () =>
  createServerConfigStore().getState().featureFlags.enableCloudSandbox !== false;

const isBuiltinToolConfigurable = (identifier: string): boolean => {
  if (EXCLUDED_TOOLS.has(identifier)) return false;
  if (identifier === CloudSandboxManifest.identifier && !isCloudSandboxAvailable()) return false;

  return true;
};

/**
 * Get all builtin tools meta list (includes hidden tools and platform-specific tools)
 * Used for agent profile tool configuration where all tools should be configurable
 * Returns availability info so UI can show hints for unavailable tools
 */
const allMetaList = (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Exclude internal tools that should not be user-configurable
      if (!isBuiltinToolConfigurable(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMetaWithAvailability);

  const skillMetas = (s.builtinSkills || []).map(toSkillMetaWithAvailability);
  const agentSkillMetas = agentSkillsSelectors
    .agentSkillMetaList(s)
    .map((meta) => ({ ...meta, availableInWeb: true }));

  return [
    ...skillMetas,
    ...agentSkillMetas,
    ...builtinMetas,
    ...getBuiltinMcpMetasWithAvailability(s),
    ...getKlavisMetasWithAvailability(s),
  ];
};

/**
 * Get installed builtin tools meta list (excludes uninstalled, includes hidden and platform-specific)
 * Used for agent profile tool configuration where only installed tools should be shown
 */
const installedAllMetaList = (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
  const { uninstalledBuiltinTools } = s;

  const builtinMetas = s.builtinTools
    .filter((item) => {
      if (!isBuiltinToolConfigurable(item.identifier)) return false;
      if (uninstalledBuiltinTools.includes(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMetaWithAvailability);

  return [
    ...builtinMetas,
    ...getBuiltinMcpMetas(s).map((meta) => ({ ...meta, availableInWeb: true })),
    ...getKlavisMetasWithAvailability(s),
  ];
};

/**
 * Get installed builtin skills (excludes uninstalled ones)
 */
const installedBuiltinSkills = (s: ToolStoreState): BuiltinSkill[] =>
  (s.builtinSkills || []).filter((skill) => {
    if (!isBuiltinSkillAvailableInCurrentEnv(skill.identifier)) return false;
    if (s.uninstalledBuiltinTools.includes(skill.identifier)) return false;

    return true;
  });

/**
 * Get the meta list of app-fixed tools (always-on, read-only, non-uninstallable).
 * These render as read-only pinned items in the skill popover (lobe-activator,
 * lobe-skills, lobe-skill-store), with no policy menu and no uninstall option.
 *
 * Aligned with lobehub upstream `fixedDisplayMetaList`. Fixed tools stay visible
 * in both 'auto' and 'manual' skillActivateMode (they are app-level always-on),
 * so the `isManualMode` parameter is accepted for parity but not used to filter
 * them out.
 */
const fixedDisplayMetaList =
  (_options: { isManualMode?: boolean } = {}) =>
  (s: ToolStoreState): LobeToolMeta[] =>
    alwaysOnToolIds
      .map((id) => s.builtinTools.find((tool) => tool.identifier === id))
      .filter((tool): tool is ToolStoreState['builtinTools'][number] => !!tool)
      .filter((tool) => isBuiltinToolAvailableInCurrentEnv(tool.identifier))
      .map(toBuiltinMeta);

/**
 * Get uninstalled builtin tool identifiers
 */
const uninstalledBuiltinTools = (s: ToolStoreState): string[] => s.uninstalledBuiltinTools;

/**
 * Check if a builtin tool is installed
 */
const isBuiltinToolInstalled = (identifier: string) => (s: ToolStoreState) =>
  !s.uninstalledBuiltinTools.includes(identifier);

export const builtinToolSelectors = {
  allMetaList,
  fixedDisplayMetaList,
  installedAllMetaList,
  installedBuiltinSkills,
  isBuiltinToolInstalled,
  metaList,
  uninstalledBuiltinTools,
};

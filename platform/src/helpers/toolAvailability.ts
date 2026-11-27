import { isDesktop } from '@lobechat/const';

import { shouldEnableBuiltinSkill } from './skillFilters';
import { shouldEnableTool } from './toolFilters';

export interface ToolAvailabilityInstalledPlugin {
  customParams?: {
    mcp?: {
      type?: string;
    } | null;
  } | null;
  identifier: string;
}

export interface ToolAvailabilityContext {
  installedPlugins?: ToolAvailabilityInstalledPlugin[];
  isDesktop?: boolean;
}

export const isBuiltinToolAvailableInCurrentEnv = (id: string) => shouldEnableTool(id);

export const isBuiltinSkillAvailableInCurrentEnv = (
  id: string,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => {
  if (context.isDesktop === undefined) {
    return shouldEnableBuiltinSkill(id);
  }

  return shouldEnableBuiltinSkill(id, {
    isDesktop: context.isDesktop ?? isDesktop,
  });
};

/**
 * Whether a tool would be usable if opened from a web browser, regardless of
 * the platform this code is actually running on right now. Unlike
 * `isBuiltinToolAvailableInCurrentEnv`, this is a static property of the tool
 * (e.g. Feishu MCP is always web-only, LocalSystem is always desktop-only) —
 * use it for compatibility hints/labels shown while editing an agent profile
 * that may later be opened from a different platform.
 */
export const isBuiltinToolAvailableOnWeb = (id: string) =>
  shouldEnableTool(id, { isDesktop: false });

/**
 * Skill counterpart of `isBuiltinToolAvailableOnWeb` — see its doc for why this
 * needs to force `isDesktop: false` instead of reading the ambient runtime.
 */
export const isBuiltinSkillAvailableOnWeb = (id: string) =>
  shouldEnableBuiltinSkill(id, { isDesktop: false });

export const isInstalledPluginAvailableInCurrentEnv = (
  plugin: ToolAvailabilityInstalledPlugin,
  context: Omit<ToolAvailabilityContext, 'installedPlugins'> = {},
) => (context.isDesktop ?? isDesktop) || plugin.customParams?.mcp?.type !== 'stdio';

export const isToolAvailableInCurrentEnv = (id: string, context: ToolAvailabilityContext = {}) => {
  if (!isBuiltinToolAvailableInCurrentEnv(id)) return false;
  if (!isBuiltinSkillAvailableInCurrentEnv(id, context)) return false;

  const plugin = context.installedPlugins?.find((item) => item.identifier === id);

  if (!plugin) return true;

  return isInstalledPluginAvailableInCurrentEnv(plugin, context);
};

export const filterToolIdsByCurrentEnv = (ids: string[], context: ToolAvailabilityContext = {}) =>
  ids.filter((id) => isToolAvailableInCurrentEnv(id, context));

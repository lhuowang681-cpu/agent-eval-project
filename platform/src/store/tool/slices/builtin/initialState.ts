import { builtinSkills } from '@lobechat/builtin-skills';
import { builtinTools, defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { type BuiltinSkill, type LobeBuiltinTool } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';

export interface BuiltinToolState {
  builtinSkills: BuiltinSkill[];
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * List of uninstalled builtin tool identifiers.
   * Seeded with `defaultUninstalledBuiltinTools` until the real per-user value
   * is fetched from settings.
   */
  uninstalledBuiltinTools: string[];
  /**
   * Loading state for fetching uninstalled builtin tools
   */
  uninstalledBuiltinToolsLoading: boolean;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinSkills: filterBuiltinSkills(builtinSkills),
  builtinToolLoading: {},
  builtinTools,
  uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
  uninstalledBuiltinToolsLoading: true,
};

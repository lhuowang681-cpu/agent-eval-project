import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import type { ActionTagData } from './types';

/**
 * Collects all available slash-selectable skills/tools and returns them as ActionTagData[].
 */
export const useEnabledSkills = (): ActionTagData[] => {
  // All data sources
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const builtinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const klavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const allMarketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const allUserAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const marketAgentSkills = useMemo(
    () => allMarketAgentSkills.filter(agentSkillsSelectors.isWebAvailableSkill),
    [allMarketAgentSkills],
  );
  const userAgentSkills = useMemo(
    () => allUserAgentSkills.filter(agentSkillsSelectors.isWebAvailableSkill),
    [allUserAgentSkills],
  );

  return useMemo(() => {
    const items: ActionTagData[] = [];
    const skillNameMap = new Map<string, string>();
    const toolNameMap = new Map<string, string>();

    // Build the skill set first: builtinList (metaList) already folds builtin
    // skills and agent skills into its result, so tools must be de-duped
    // against this set to avoid the same identifier appearing as both a
    // "skill" and a "tool" entry.
    for (const item of builtinSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }
    for (const item of marketAgentSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }
    for (const item of userAgentSkills) {
      skillNameMap.set(item.identifier, item.name || item.identifier);
    }

    for (const item of builtinList) {
      if (skillNameMap.has(item.identifier)) continue;
      toolNameMap.set(item.identifier, item.title || item.identifier);
    }
    for (const item of installedPlugins) {
      if (skillNameMap.has(item.identifier)) continue;
      toolNameMap.set(item.identifier, item.title || item.identifier);
    }
    for (const item of klavisServers) {
      if (skillNameMap.has(item.identifier)) continue;
      toolNameMap.set(item.identifier, item.serverName || item.identifier);
    }
    for (const item of lobehubSkillServers) {
      if (skillNameMap.has(item.identifier)) continue;
      toolNameMap.set(item.identifier, item.name || item.identifier);
    }

    for (const [id, label] of skillNameMap) {
      items.push({ category: 'skill', label, type: id });
    }

    for (const [id, label] of toolNameMap) {
      items.push({ category: 'tool', label, type: id });
    }

    return items;
  }, [
    builtinList,
    builtinSkills,
    installedPlugins,
    klavisServers,
    lobehubSkillServers,
    marketAgentSkills,
    userAgentSkills,
  ]);
};

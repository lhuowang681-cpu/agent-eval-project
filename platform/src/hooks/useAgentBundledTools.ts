import type { KnowledgeBaseItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useKnowledgeBaseStore } from '@/store/library';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

export interface BundledMarketTool {
  identifier: string;
  name: string;
  source: string;
}

const resolveKnowledgeBaseSource = (kb: KnowledgeBaseItem): string => {
  if (kb.installedFromMarketIdentifier) return 'market';
  if (kb.marketIdentifier && kb.marketVisibility === 'public') return 'market';
  if (kb.marketIdentifier) return 'bundled';
  return 'local';
};

export const useAgentBundledTools = (agentId?: string) => {
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId || ''), isEqual);
  const knowledgeBases = useAgentStore(
    agentSelectors.getAgentConfigById(agentId || ''),
    isEqual,
  )?.knowledgeBases;
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPlugins, isEqual);
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  const useFetchPluginStore = useToolStore((s) => s.useFetchPluginStore);
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);

  useFetchAgentSkills(Boolean(agentId));
  useFetchPluginStore();
  const { data: kbCatalog } = useFetchKnowledgeBaseList();

  const pluginIds = config?.plugins || [];
  const skillIds = config?.skills || [];

  return useMemo(() => {
    const kbMap = new Map((kbCatalog || []).map((item) => [item.id, item]));

    const skills: BundledMarketTool[] = [];
    const mcps: BundledMarketTool[] = [];
    const addedSkillIds = new Set<string>();
    const kbs: BundledMarketTool[] = (knowledgeBases || [])
      .filter((kb) => kb?.id && kb.enabled !== false)
      .map((kb) => {
        const enriched = kbMap.get(kb!.id) || kb!;
        return {
          identifier: kb!.id,
          name: kb!.name || kb!.id,
          source: resolveKnowledgeBaseSource(enriched),
        };
      });

    const addSkill = (identifier: string, fallbackName?: string) => {
      if (addedSkillIds.has(identifier)) return true;

      const skill = agentSkills.find((item) => item.identifier === identifier);
      if (!skill && !fallbackName) return false;

      addedSkillIds.add(identifier);
      skills.push({
        identifier: skill?.identifier ?? identifier,
        name: skill?.name ?? fallbackName ?? identifier,
        source: skill?.source ?? 'local',
      });
      return true;
    };

    for (const skillId of skillIds) {
      addSkill(skillId, skillId);
    }

    for (const pluginId of pluginIds) {
      if (addSkill(pluginId)) continue;

      const plugin = installedPlugins.find((item) => item.identifier === pluginId);
      if (plugin) {
        mcps.push({
          identifier: plugin.identifier,
          name: plugin.manifest?.meta?.title || plugin.identifier,
          source: plugin.source || plugin.type,
        });
      }
    }

    return { kbs, mcps, skills };
  }, [agentSkills, installedPlugins, kbCatalog, knowledgeBases, pluginIds, skillIds]);
};

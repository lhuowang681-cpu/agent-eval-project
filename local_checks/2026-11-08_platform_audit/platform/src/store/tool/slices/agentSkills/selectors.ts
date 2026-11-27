import { isDesktop } from '@lobechat/const';
import type { LobeToolMeta, SkillItem, SkillListItem } from '@lobechat/types';

import type { ToolStoreState } from '../../initialState';

const getAgentSkills = (s: ToolStoreState): SkillListItem[] => s.agentSkills || [];

const isWebAvailableSkill = (skill: SkillListItem) =>
  isDesktop || skill.webSafeScanPassed !== false;

const getMarketAgentSkills = (s: ToolStoreState): SkillListItem[] =>
  (s.agentSkills || []).filter((skill) => skill.source === 'market');

const getUserAgentSkills = (s: ToolStoreState): SkillListItem[] =>
  (s.agentSkills || []).filter((skill) => skill.source === 'user');

const getAgentSkillByIdentifier =
  (identifier: string) =>
  (s: ToolStoreState): SkillListItem | undefined =>
    (s.agentSkills || []).find((skill) => skill.identifier === identifier);

const getAgentSkillDetail =
  (id: string) =>
  (s: ToolStoreState): SkillItem | undefined =>
    s.agentSkillDetailMap?.[id];

const isAgentSkill =
  (identifier: string) =>
  (s: ToolStoreState): boolean =>
    (s.agentSkills || []).some((skill) => skill.identifier === identifier);

const agentSkillMetaList = (s: ToolStoreState): LobeToolMeta[] =>
  (s.agentSkills || []).filter(isWebAvailableSkill).map((skill) => {
    const author = skill.manifest?.author;
    const authorName = typeof author === 'string' ? author : author?.name || 'User';

    return {
      author: authorName,
      identifier: skill.identifier,
      meta: {
        avatar: '🧩',
        description: skill.description ?? skill.manifest?.description ?? '',
        title: skill.name,
      },
      type: 'builtin' as const,
    };
  });

export const agentSkillsSelectors = {
  agentSkillMetaList,
  getAgentSkillByIdentifier,
  getAgentSkillDetail,
  getAgentSkills,
  getMarketAgentSkills,
  getUserAgentSkills,
  isWebAvailableSkill,
  isAgentSkill,
};

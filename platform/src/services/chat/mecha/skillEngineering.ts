import { isDesktop } from '@lobechat/const';
import { SkillEngine } from '@lobechat/context-engine';

import { isBuiltinSkillAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { getToolStoreState } from '@/store/tool';

const isAgentSkillAvailableInCurrentEnv = (skill: { webSafeScanPassed?: boolean }) =>
  isDesktop || skill.webSafeScanPassed !== false;

export const getUnavailableAgentSkillsForCurrentEnv = () => {
  const toolState = getToolStoreState();

  return (toolState.agentSkills || []).filter((skill) => !isAgentSkillAvailableInCurrentEnv(skill));
};

export const buildUnavailableAgentSkillsNotice = (
  skills: Array<{ description?: string | null; name: string }>,
): string | undefined => {
  if (skills.length === 0) return undefined;

  const skillTags = skills
    .map((skill) => `  <skill name="${skill.name}">${skill.description ?? ''}</skill>`)
    .join('\n');

  return `<unavailable_skills>
${skillTags}
</unavailable_skills>

These skills were uploaded through desktop or imported without passing the web security scan. They are not available in web/cloud execution. Do not call runSkill for them. If the user asks about them, explain that they need to sync it to web first.`;
};

/**
 * Create a SkillEngine by merging all skill sources from toolStore
 *
 * Sources:
 * 1. Builtin skills (e.g., Artifacts) - from toolStore.builtinSkills
 * 2. DB skills (user/market) - from toolStore.agentSkills
 */
export const createSkillEngine = (): SkillEngine => {
  const toolState = getToolStoreState();
  const uninstalled = new Set(toolState.uninstalledBuiltinTools);

  // Source 1: builtin skills
  const builtinMetas = (toolState.builtinSkills || [])
    .filter((s) => !uninstalled.has(s.identifier))
    .filter((s) => isBuiltinSkillAvailableInCurrentEnv(s.identifier))
    .map((s) => ({
      description: s.description,
      identifier: s.identifier,
      name: s.name,
    }));

  // Source 2: DB skills (agentSkills table)
  const dbMetas = (toolState.agentSkills || [])
    .filter(isAgentSkillAvailableInCurrentEnv)
    .map((s) => ({
      description: s.description ?? '',
      identifier: s.identifier,
      name: s.name,
    }));

  return new SkillEngine({ skills: [...builtinMetas, ...dbMetas] });
};

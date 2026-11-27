import { communityApiService } from '@/services/marketApi';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const resolveMcpMarketIdentifier = (identifier: string): string | undefined => {
  const plugin = pluginSelectors.getInstalledPluginById(identifier)(useToolStore.getState());
  return plugin?.marketIdentifier ?? plugin?.installedFromMarketIdentifier ?? identifier;
};

const resolveSkillMarketIdentifierByName = (skillName: string): string | undefined => {
  const skills = useToolStore.getState().agentSkills || [];
  const skill = skills.find((item) => item.name === skillName || item.manifest?.name === skillName);
  if (!skill) return undefined;

  return skill.marketIdentifier ?? skill.installedFromMarketIdentifier ?? undefined;
};

export const reportClientMcpMarketUsage = (mcpIdentifier: string, agentId?: string): void => {
  const marketIdentifier = resolveMcpMarketIdentifier(mcpIdentifier);
  if (!marketIdentifier) return;

  void communityApiService.recordMcpUsage(marketIdentifier, agentId).catch(() => {});
};

export const reportClientSkillMarketUsage = (skillName: string, agentId?: string): void => {
  const marketIdentifier = resolveSkillMarketIdentifierByName(skillName);
  if (!marketIdentifier) return;

  void communityApiService.recordSkillUsage(marketIdentifier, agentId).catch(() => {});
};

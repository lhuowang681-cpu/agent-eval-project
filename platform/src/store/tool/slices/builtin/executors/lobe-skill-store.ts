/**
 * Lobe Skill Store Executor
 *
 * Creates and exports the SkillStoreExecutor instance for registration.
 * Handles skill search and import from market/URL.
 */
import { SkillStoreExecutionRuntime } from '@lobechat/builtin-tool-skill-store/executionRuntime';
import { SkillStoreExecutor } from '@lobechat/builtin-tool-skill-store/executor';
import { type SkillImportStatus } from '@lobechat/types';

import { discoverService } from '@/services/discover';
import { communityApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';

// Create runtime with client-side service
const runtime = new SkillStoreExecutionRuntime({
  service: {
    importFromGitHub: async (gitUrl) => {
      const result = await agentSkillService.importFromGitHub({ gitUrl });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromMarket: async (identifier) => {
      const existing = await agentSkillService.getByIdentifier(identifier);
      const status: SkillImportStatus = !existing
        ? 'created'
        : existing.installedFromMarketIdentifier === identifier && existing.zipFileHash
          ? 'unchanged'
          : 'updated';
      const skill = await communityApiService.installSkill(identifier);
      if (!skill) throw new Error('Import failed');
      return { skill: { id: skill.id, name: skill.name }, status };
    },
    importFromUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromZipUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    onSkillImported: async () => {
      // Dynamic import to avoid circular dependency (this file is inside the tool store)
      const { getToolStoreState } = await import('@/store/tool/store');
      await getToolStoreState().refreshAgentSkills();
    },
    searchSkill: async (params) => {
      const result = await discoverService.getSkillList({
        ...params,
        sort: params.sort as any,
      });
      // Transform SDK response to match expected interface
      return {
        items: result.items,
        page: result.currentPage,
        pageSize: result.pageSize,
        total: result.totalCount,
      };
    },
  },
});

// Create executor instance with the runtime
export const skillStoreExecutor = new SkillStoreExecutor(runtime);

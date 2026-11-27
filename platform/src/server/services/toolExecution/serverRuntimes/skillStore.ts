import {
  type MarketSkillItem,
  type SearchSkillParams,
  SkillStoreIdentifier,
} from '@lobechat/builtin-tool-skill-store';
import {
  type SkillImportServiceResult,
  SkillStoreExecutionRuntime,
  type SkillStoreRuntimeService,
} from '@lobechat/builtin-tool-skill-store/executionRuntime';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { CommunityService } from '@/server/services/community';
import { SkillImporter } from '@/server/services/skill/importer';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skill-store-runtime');

const mapSkillStoreSort = (
  sort?: SearchSkillParams['sort'],
): 'installCount' | 'recommended' | 'updatedAt' => {
  if (sort === 'installCount') return 'installCount';
  if (sort === 'updatedAt' || sort === 'createdAt') return 'updatedAt';
  return 'recommended';
};

const toISOString = (value?: Date | string | null) => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
};

export class SkillStoreServerRuntimeService implements SkillStoreRuntimeService {
  private communityService: Pick<CommunityService, 'getSkillList' | 'installSkill'>;
  private importer: SkillImporter;
  private skillModel: Pick<AgentSkillModel, 'findByIdentifier'>;

  constructor(options: {
    communityService: Pick<CommunityService, 'getSkillList' | 'installSkill'>;
    importer: SkillImporter;
    skillModel: Pick<AgentSkillModel, 'findByIdentifier'>;
  }) {
    this.communityService = options.communityService;
    this.importer = options.importer;
    this.skillModel = options.skillModel;
  }

  importFromGitHub = async (gitUrl: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromGitHub({ gitUrl });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromZipUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  searchSkill = async (
    params: SearchSkillParams,
  ): Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }> => {
    log('Searching skills with params: %O', params);

    try {
      const result = await this.communityService.getSkillList({
        ...(params.category ? { category: params.category } : {}),
        ...(params.q ? { keyword: params.q } : {}),
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        sortBy: mapSkillStoreSort(params.sort),
      });
      log('Search skills result: %O', result);

      return {
        items: result.data.map((skill) => ({
          category: skill.category ?? undefined,
          createdAt: toISOString(skill.createdAt),
          description: skill.description || '',
          identifier: skill.identifier,
          installCount: skill.installCount || 0,
          name: skill.name,
          updatedAt: toISOString(skill.updatedAt),
          version: skill.version ?? undefined,
        })),
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        total: result.total,
      };
    } catch (error) {
      log('Error searching skills: %O', error);
      throw error;
    }
  };

  importFromMarket = async (identifier: string): Promise<SkillImportServiceResult> => {
    log('Importing skill from market: %s', identifier);

    try {
      const existing = await this.skillModel.findByIdentifier(identifier);
      const status: SkillImportServiceResult['status'] = !existing
        ? 'created'
        : existing.installedFromMarketIdentifier === identifier && existing.zipFileHash
          ? 'unchanged'
          : 'updated';
      const skill = await this.communityService.installSkill(identifier);
      const result: SkillImportServiceResult = {
        skill: { id: skill.id, name: skill.name },
        status,
      };
      log('Import from market result: %O', result);
      return result;
    } catch (error) {
      log('Error importing skill from market: %O', error);
      throw error;
    }
  };
}

/**
 * Skill Store Server Runtime
 * Per-request runtime (needs serverDB, userId)
 */
export const skillStoreRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skill Store execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skill Store execution');
    }

    const importer = new SkillImporter(context.serverDB, context.userId);
    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const communityService = new CommunityService({
      serverDB: context.serverDB,
      userId: context.userId,
    });

    const service = new SkillStoreServerRuntimeService({
      communityService,
      importer,
      skillModel,
    });

    return new SkillStoreExecutionRuntime({ service });
  },
  identifier: SkillStoreIdentifier,
};

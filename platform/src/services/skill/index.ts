import type {
  CreateSkillInput,
  ImportGitHubInput,
  ImportUrlInput,
  ImportZipInput,
  SkillImportResult,
  SkillItem,
  SkillListItem,
  SkillResourceContent,
  SkillResourceTreeNode,
  SkillSource,
  UpdateSkillInput,
} from '@lobechat/types';

import type { ScanStatusResponse } from '@/helpers/skillScanReport';
import { lambdaClient } from '@/libs/trpc/client';

type AgentSkillListSource = Extract<SkillSource, 'builtin' | 'market' | 'user'>;

class AgentSkillService {
  // ===== Create =====

  async createSkill(params: CreateSkillInput): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.create.mutate(params);
  }

  // ===== Security Scan =====

  async startScanForZip(params: { zipFileId: string }): Promise<{ scanId: string | null }> {
    return (await lambdaClient.agentSkills.startScanForZip.mutate(params)) ?? { scanId: null };
  }

  async startScanForGitHub(params: {
    gitUrl: string;
    branch?: string;
  }): Promise<{ scanId: string | null }> {
    return (await lambdaClient.agentSkills.startScanForGitHub.mutate(params)) ?? { scanId: null };
  }

  async startScanForUrl(params: { url: string }): Promise<{ scanId: string | null }> {
    return (await lambdaClient.agentSkills.startScanForUrl.mutate(params)) ?? { scanId: null };
  }

  async getScanStatus(params: { scanId: string }): Promise<ScanStatusResponse> {
    const status = await lambdaClient.agentSkills.getScanStatus.query(params);
    return status ?? { scan_id: params.scanId, status: 'failed' };
  }

  async syncToWeb(id: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.syncToWeb.mutate({ id });
  }

  // ===== Import =====

  async importFromGitHub(
    params: ImportGitHubInput & { scanId?: string; skipSecurityScan?: boolean },
  ): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromGitHub.mutate(params);
  }

  async importFromUrl(
    params: ImportUrlInput & { scanId?: string; skipSecurityScan?: boolean },
  ): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromUrl.mutate(params);
  }

  async importFromZip(
    params: ImportZipInput & { scanId?: string; skipSecurityScan?: boolean },
  ): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromZip.mutate(params);
  }

  async importFromMarket(identifier: string): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromMarket.mutate({ identifier });
  }

  // ===== Query =====

  async getById(id: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getById.query({ id });
  }

  async getZipUrl(id: string): Promise<{ name: string; url: string | null }> {
    return lambdaClient.agentSkills.getByIdWithZipUrl.query({ id });
  }

  async getByIdentifier(identifier: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getByIdentifier.query({ identifier });
  }

  async getByName(name: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getByName.query({ name });
  }

  async list(source?: AgentSkillListSource): Promise<{ data: SkillListItem[]; total: number }> {
    return lambdaClient.agentSkills.list.query(source ? { source } : undefined);
  }

  async search(query: string): Promise<{ data: SkillListItem[]; total: number }> {
    return lambdaClient.agentSkills.search.query({ query });
  }

  // ===== Resources =====

  async listResources(id: string, includeContent?: boolean): Promise<SkillResourceTreeNode[]> {
    return lambdaClient.agentSkills.listResources.query({ id, includeContent });
  }

  async readResource(id: string, path: string): Promise<SkillResourceContent> {
    return lambdaClient.agentSkills.readResource.query({ id, path });
  }

  // ===== Update =====

  async updateSkill(params: UpdateSkillInput): Promise<SkillItem> {
    return lambdaClient.agentSkills.update.mutate({
      content: params.content,
      id: params.id,
      manifest: params.manifest,
    });
  }

  // ===== Delete =====

  async deleteSkill(id: string): Promise<{ success: boolean }> {
    return lambdaClient.agentSkills.delete.mutate({ id });
  }
}

export const agentSkillService = new AgentSkillService();

import { lambdaClient } from '@/libs/trpc/client';

class CommunityApiService {
  // ===== My Published Lists =====

  getMyAssistantList = (params: {
    keyword?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => lambdaClient.market.agent.getMyAssistantList.query(params);

  getMyMcpList = (params: {
    keyword?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => lambdaClient.market.mcp.getMyMcpList.query(params);

  getMySkillList = (params: {
    keyword?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => lambdaClient.market.skill.getMySkillList.query(params);

  getMyKnowledgeBaseList = (params: {
    keyword?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => lambdaClient.market.knowledgeBase.getMyKnowledgeBaseList.query(params);

  // ===== Agent =====

  publishAgent = (
    agentId: string,
    bundledSkillIdentifiers?: string[],
    bundledMcpIdentifiers?: string[],
    bundledKnowledgeBaseIdentifiers?: string[],
    newDisplayName?: string,
    category?: string,
  ) =>
    lambdaClient.market.agent.publishAgent.mutate({
      agentId,
      bundledKnowledgeBaseIdentifiers,
      bundledMcpIdentifiers,
      bundledSkillIdentifiers,
      category: category!,
      newDisplayName,
    });

  checkAgentPublishNameConflict = (displayName: string, excludeIdentifier?: string) =>
    lambdaClient.market.agent.checkPublishNameConflict.query({ displayName, excludeIdentifier });

  updateAgent = (identifier: string) =>
    lambdaClient.market.agent.updateAgent.mutate({ identifier });

  delistAgent = (identifier: string) =>
    lambdaClient.market.agent.delistAgent.mutate({ identifier });

  relistAgent = (identifier: string) =>
    lambdaClient.market.agent.relistAgent.mutate({ identifier });

  installAgent = (identifier: string) =>
    lambdaClient.market.agent.installAgent.mutate({ identifier });

  updateInstalledAgent = (identifier: string) =>
    lambdaClient.market.agent.updateInstalledAgent.mutate({ identifier });

  publishSkill = (skillId: string, category: string, newDisplayName?: string) =>
    lambdaClient.market.skill.publishSkill.mutate({ category, newDisplayName, skillId });

  checkSkillPublishNameConflict = (displayName: string, excludeIdentifier?: string) =>
    lambdaClient.market.skill.checkPublishNameConflict.query({ displayName, excludeIdentifier });

  updateSkill = (identifier: string) =>
    lambdaClient.market.skill.updateSkill.mutate({ identifier });

  delistSkill = (identifier: string) =>
    lambdaClient.market.skill.delistSkill.mutate({ identifier });

  relistSkill = (identifier: string) =>
    lambdaClient.market.skill.relistSkill.mutate({ identifier });

  restoreSkillToLocal = (identifier: string) =>
    lambdaClient.market.skill.restoreSkillToLocal.mutate({ identifier });

  installSkill = (identifier: string) =>
    lambdaClient.market.skill.installSkill.mutate({ identifier });

  updateInstalledSkill = (identifier: string) =>
    lambdaClient.market.skill.updateInstalledSkill.mutate({ identifier });

  publishMcp = (
    identifier: string,
    manifest: Record<string, unknown>,
    customParams: Record<string, unknown>,
    category: string,
    newDisplayName?: string,
  ) =>
    lambdaClient.market.mcp.publishMcp.mutate({
      category,
      customParams,
      identifier,
      manifest,
      newDisplayName,
    });

  checkMcpPublishNameConflict = (displayName: string, excludeIdentifier?: string) =>
    lambdaClient.market.mcp.checkPublishNameConflict.query({ displayName, excludeIdentifier });

  updateMcp = (
    identifier: string,
    manifest?: Record<string, unknown>,
    customParams?: Record<string, unknown>,
  ) =>
    lambdaClient.market.mcp.updateMcp.mutate({
      customParams,
      identifier,
      manifest,
    });

  delistMcp = (identifier: string) => lambdaClient.market.mcp.delistMcp.mutate({ identifier });

  relistMcp = (identifier: string) => lambdaClient.market.mcp.relistMcp.mutate({ identifier });

  restoreMcpToLocal = (identifier: string) =>
    lambdaClient.market.mcp.restoreMcpToLocal.mutate({ identifier });

  installMcp = (identifier: string) => lambdaClient.market.mcp.installMcp.mutate({ identifier });

  updateInstalledMcp = (identifier: string) =>
    lambdaClient.market.mcp.updateInstalledMcp.mutate({ identifier });

  publishKnowledgeBase = (knowledgeBaseId: string, newDisplayName?: string) =>
    lambdaClient.market.knowledgeBase.publishKnowledgeBase.mutate({
      knowledgeBaseId,
      newDisplayName,
    });

  checkKnowledgeBasePublishNameConflict = (displayName: string, excludeIdentifier?: string) =>
    lambdaClient.market.knowledgeBase.checkPublishNameConflict.query({
      displayName,
      excludeIdentifier,
    });

  updateKnowledgeBase = (identifier: string) =>
    lambdaClient.market.knowledgeBase.updateKnowledgeBase.mutate({ identifier });

  delistKnowledgeBase = (identifier: string) =>
    lambdaClient.market.knowledgeBase.delistKnowledgeBase.mutate({ identifier });

  relistKnowledgeBase = (identifier: string) =>
    lambdaClient.market.knowledgeBase.relistKnowledgeBase.mutate({ identifier });

  installKnowledgeBase = (identifier: string) =>
    lambdaClient.market.knowledgeBase.installKnowledgeBase.mutate({ identifier });

  updateInstalledKnowledgeBase = (identifier: string) =>
    lambdaClient.market.knowledgeBase.updateInstalledKnowledgeBase.mutate({ identifier });

  getLeaderboard = (params?: { days?: number; limit?: number }) =>
    lambdaClient.market.getLeaderboard.query(params);

  getUnpublishedResources = () => lambdaClient.market.getUnpublishedResources.query();

  getPublisherResourceStates = () => lambdaClient.market.getPublisherResourceStates.query();

  relistAgentWithSync = (
    identifier: string,
    options?: { category?: string; displayName?: string },
  ) =>
    lambdaClient.market.agent.relistAgent.mutate({
      category: options?.category,
      displayName: options?.displayName,
      identifier,
    });

  relistSkillWithSync = (
    identifier: string,
    options?: { category?: string; displayName?: string },
  ) =>
    lambdaClient.market.skill.relistSkill.mutate({
      category: options?.category,
      displayName: options?.displayName,
      identifier,
    });

  relistMcpWithSync = (identifier: string, options?: { category?: string; displayName?: string }) =>
    lambdaClient.market.mcp.relistMcp.mutate({
      category: options?.category,
      displayName: options?.displayName,
      identifier,
    });

  relistKnowledgeBaseWithSync = (
    identifier: string,
    options?: { category?: string; displayName?: string },
  ) =>
    lambdaClient.market.knowledgeBase.relistKnowledgeBase.mutate({
      category: options?.category,
      displayName: options?.displayName,
      identifier,
    });

  recordAgentUsage = (agentIdentifier: string) =>
    lambdaClient.market.recordAgentUsage.mutate({ agentIdentifier });

  recordSkillUsage = (skillIdentifier: string, agentId?: string) =>
    lambdaClient.market.recordSkillUsage.mutate({ agentId, skillIdentifier });

  recordMcpUsage = (mcpIdentifier: string, agentId?: string) =>
    lambdaClient.market.recordMcpUsage.mutate({ agentId, mcpIdentifier });

  // ===== Peer Share (point-to-point, bypasses market listing) =====

  createShare = (itemType: 'agent' | 'mcp' | 'skill', localId: string) =>
    lambdaClient.market.share.create.mutate({ itemType, localId });

  getShareByToken = (token: string) => lambdaClient.market.share.getByToken.query({ token });

  revokeShare = (token: string) => lambdaClient.market.share.revoke.mutate({ token });

  getMyShares = () => lambdaClient.market.share.myShares.query();

  recordShareInstall = (token: string) => lambdaClient.market.share.recordInstall.mutate({ token });
}

export const communityApiService = new CommunityApiService();

/** @deprecated Use communityApiService */
export const marketApiService = communityApiService;

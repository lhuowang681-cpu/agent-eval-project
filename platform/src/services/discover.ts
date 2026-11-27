import { type CategoryItem, type PluginManifest } from '@lobehub/market-sdk';
import {
  type AgentEventRequest,
  type CallReportRequest,
  type InstallReportRequest,
  type PluginEventRequest,
} from '@lobehub/market-types';

import { lambdaClient } from '@/libs/trpc/client';
import { communityApiService } from '@/services/marketApi';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import {
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type DiscoverKnowledgeBaseDetail,
  type DiscoverMcpDetail,
  type DiscoverModelDetail,
  type DiscoverPluginDetail,
  type DiscoverProviderDetail,
  type DiscoverSkillDetail,
  type DiscoverUserProfile,
  type IdentifiersResponse,
  type KnowledgeBaseListResponse,
  type KnowledgeBaseQueryParams,
  type McpListResponse,
  type McpQueryParams,
  type ModelListResponse,
  type PluginListResponse,
  type ProviderListResponse,
  type SkillCategoryItem,
  type SkillListResponse,
  type SkillQueryParams,
} from '@/types/discover';
import { type MCPPluginListParams } from '@/types/plugins';
import { cleanObject } from '@/utils/object';

class DiscoverService {
  private _isRetrying = false;
  private _tokenRefreshPromise: Promise<void> | null = null;

  private isMarketTrustedClientEnabled = (): boolean => {
    if (typeof window === 'undefined' || !window.global_serverConfigStore) return false;
    try {
      const state = window.global_serverConfigStore.getState();
      return state.serverConfig.enableMarketTrustedClient || false;
    } catch {
      return false;
    }
  };

  safeInjectMPToken = async () => {};

  // ============================== Assistant Market ==============================
  getAssistantCategories = async (): Promise<CategoryItem[]> => [];

  getAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    source?: AssistantMarketSource;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    const { transformMarketAgentToDetail } = await import('@/services/market/transformers');
    const row = await lambdaClient.market.getAssistantDetail.query({
      identifier: params.identifier,
    });
    if (!row) return undefined;
    return transformMarketAgentToDetail(row);
  };

  getAssistantIdentifiers = async (): Promise<IdentifiersResponse> => {
    const { transformAssistantListResponse } = await import('@/services/market/transformers');
    const list = await lambdaClient.market.getAssistantList.query({
      page: 1,
      pageSize: 1000,
    });
    const transformed = transformAssistantListResponse(list, 1, 1000);
    return { identifiers: transformed.items.map((item) => item.identifier) };
  };

  getAssistantList = async (params: AssistantQueryParams = {}): Promise<AssistantListResponse> => {
    const { mapAssistantSort, transformAssistantListResponse } =
      await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;
    const shouldOmitCategory = ['all', 'discover'].includes(params.category || '');

    const result = await lambdaClient.market.getAssistantList.query(
      {
        category: shouldOmitCategory ? undefined : params.category,
        keyword: params.q,
        page,
        pageSize,
        sortBy: mapAssistantSort(params.sort),
      },
      { context: { showNotification: false } },
    );

    return transformAssistantListResponse(result, page, pageSize);
  };

  getMyAssistantList = async (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): Promise<AssistantListResponse> => {
    const { transformAssistantListResponse } = await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    const result = await communityApiService.getMyAssistantList({
      keyword: params.keyword,
      page,
      pageSize,
      sortBy: params.sortBy,
    });

    return transformAssistantListResponse(result, page, pageSize);
  };

  getAgentsByPlugin = async (): Promise<AssistantListResponse> => ({
    currentPage: 1,
    items: [],
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  });

  // ============================== MCP Market ==============================

  getMcpCategories = async (): Promise<CategoryItem[]> => [];

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    const { transformMarketMcpToDetail } = await import('@/services/market/transformers');
    const row = await lambdaClient.market.getMcpDetail.query({
      identifier: params.identifier,
    });
    if (!row) throw new Error('MCP not found');
    return transformMarketMcpToDetail(row);
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    const { mapMcpSort, transformMcpListResponse } = await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;
    const shouldOmitCategory = ['all', 'discover'].includes(params.category || '');

    const result = await lambdaClient.market.getMcpList.query({
      category: shouldOmitCategory ? undefined : params.category,
      connectionType: params.connectionType,
      keyword: params.q,
      page,
      pageSize,
      sortBy: mapMcpSort(params.sort),
    });

    return transformMcpListResponse(result, page, pageSize);
  };

  getMyMcpList = async (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): Promise<McpListResponse> => {
    const { transformMcpListResponse } = await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    const result = await communityApiService.getMyMcpList({
      keyword: params.keyword,
      page,
      pageSize,
      sortBy: params.sortBy,
    });

    return transformMcpListResponse(result, page, pageSize);
  };

  getMCPPluginList = async (params: MCPPluginListParams): Promise<McpListResponse> => {
    return this.getMcpList({
      ...params,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    });
  };

  getMcpManifest = async (params: { identifier: string }) => {
    const detail = await this.getMcpDetail({ identifier: params.identifier });
    return detail.manifest;
  };

  getMCPPluginManifest = async (identifier: string): Promise<PluginManifest> => {
    const detail = await this.getMcpDetail({ identifier });
    const manifest = (detail.manifest || {}) as PluginManifest;

    return {
      ...manifest,
      deploymentOptions: manifest.deploymentOptions || (detail.deploymentOptions as any),
    };
  };

  registerClient = async () => {
    throw new Error('Market client registration is not supported in community market');
  };

  /**
   * Report MCP plugin installation result
   */
  reportMcpInstallResult = async ({
    success,
    manifest,
    errorMessage,
    errorCode,
    ...params
  }: InstallReportRequest) => {
    // if user don't allow tracing, just not report installation
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;
    await this.safeInjectMPToken();

    const reportData = {
      errorCode: success ? undefined : errorCode,
      errorMessage: success ? undefined : errorMessage,
      manifest: success ? manifest : undefined,
      success,
      ...params,
    };

    void reportData;
  };

  /**
   * Report plugin call result
   */
  reportPluginCall = async (reportData: CallReportRequest) => {
    // if user don't allow tracing , just not report calling
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;

    await this.safeInjectMPToken();

    void reportData;
  };

  reportMcpEvent = async (eventData: PluginEventRequest) => {
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());
    if (!allow) return;

    await this.safeInjectMPToken();

    const payload = cleanObject({
      ...eventData,
      source: eventData.source ?? 'community/mcp',
    });

    void payload;
  };

  /**
   * Report agent installation to increase install count
   */
  reportAgentInstall = async (identifier: string) => {
    // if user don't allow tracing, just not report installation
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;

    await this.safeInjectMPToken();

    void identifier;
  };

  reportAgentEvent = async (eventData: AgentEventRequest) => {
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());
    if (!allow) return;

    await this.safeInjectMPToken();

    const payload = cleanObject({
      ...eventData,
      source: eventData.source ?? 'community/agent',
    });

    void payload;
  };

  // ============================== Models ==============================

  getModelCategories = async (): Promise<CategoryItem[]> => [];

  getModelDetail = async (): Promise<DiscoverModelDetail | undefined> => undefined;

  getModelIdentifiers = async (): Promise<IdentifiersResponse> => ({ identifiers: [] });

  getModelList = async (): Promise<ModelListResponse> => ({
    currentPage: 1,
    items: [],
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  });

  // ============================== Plugin Market ==============================

  getPluginCategories = async (): Promise<CategoryItem[]> => [];

  getPluginDetail = async (params: {
    identifier: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    // For local market, try to get MCP detail from our API
    try {
      const mcpDetail = await this.getMcpDetail({ identifier: params.identifier });
      // Convert MCP detail to plugin detail format
      return {
        author:
          typeof mcpDetail.author === 'string' ? mcpDetail.author : mcpDetail.author?.name || '',
        avatar: mcpDetail.icon || '',
        category: mcpDetail.category,
        createdAt: mcpDetail.createdAt || '',
        description: mcpDetail.description || '',
        homepage: mcpDetail.homepage || `/community/mcp/${mcpDetail.identifier}`,
        identifier: mcpDetail.identifier,
        manifest: params.withManifest ? mcpDetail.manifest : undefined,
        related: [],
        schemaVersion: 1,
        source: 'market' as const,
        tags: mcpDetail.tags || [],
        title: mcpDetail.name || mcpDetail.identifier,
      };
    } catch {
      return undefined;
    }
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => ({ identifiers: [] });

  getPluginList = async (): Promise<PluginListResponse> => ({
    currentPage: 1,
    items: [],
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  });

  // ============================== Providers ==============================

  getProviderDetail = async (): Promise<DiscoverProviderDetail | undefined> => undefined;

  getProviderIdentifiers = async (): Promise<IdentifiersResponse> => ({ identifiers: [] });

  getProviderList = async (): Promise<ProviderListResponse> => ({
    currentPage: 1,
    items: [],
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  });

  // ============================== User Profile ==============================

  getUserInfo = async (): Promise<DiscoverUserProfile | undefined> => undefined;

  // ============================== Helpers ==============================

  async injectMPToken() {
    if (typeof localStorage === 'undefined') return;

    // Check server-set status flag cookie
    const tokenStatus = this.getTokenStatusFromCookie();
    if (tokenStatus === 'active') return;

    // If a token refresh is already in progress, wait for it to complete
    if (this._tokenRefreshPromise) {
      await this._tokenRefreshPromise;
      return;
    }

    // Create a new refresh promise and execute
    this._tokenRefreshPromise = this._doRefreshToken();
    try {
      await this._tokenRefreshPromise;
    } finally {
      this._tokenRefreshPromise = null;
    }
  }

  private async _doRefreshToken() {
    let clientId: string;
    let clientSecret: string;

    // 1. Get client information from localStorage
    const item = localStorage.getItem('_mpc');
    if (!item) {
      // 2. If not exists, register client
      const clientInfo = await this.registerClient();
      clientId = clientInfo.clientId;
      clientSecret = clientInfo.clientSecret;

      // 3. Base64 encode and save to localStorage
      const clientData = JSON.stringify({ clientId, clientSecret });
      const encodedData = btoa(clientData);
      localStorage.setItem('_mpc', encodedData);
    } else {
      // 4. If exists, decode to get client information
      try {
        const decodedData = atob(item);
        const clientData = JSON.parse(decodedData);
        clientId = clientData.clientId;
        clientSecret = clientData.clientSecret;
      } catch (error) {
        console.error('Failed to decode client data:', error);
        // If decoding fails, re-register
        const clientInfo = await this.registerClient();
        clientId = clientInfo.clientId;
        clientSecret = clientInfo.clientSecret;

        const clientData = JSON.stringify({ clientId, clientSecret });
        const encodedData = btoa(clientData);
        localStorage.setItem('_mpc', encodedData);
      }
    }

    // 5. Get access token (server will automatically set HTTP-Only cookie)
    try {
      const result = await lambdaClient.market.registerM2MToken.query({
        clientId,
        clientSecret,
      });

      // Check server response result
      if (!result.success) {
        console.warn(
          'Token registration failed, client credentials may be invalid. Clearing and retrying...',
        );

        // Clear related local storage data
        localStorage.removeItem('_mpc');

        // Re-execute the complete registration process (but only retry once)
        if (!this._isRetrying) {
          this._isRetrying = true;
          try {
            await this._doRefreshToken();
          } finally {
            this._isRetrying = false;
          }
        } else {
          console.error('Failed to re-register after credential invalidation');
        }

        return;
      }

      // 6. Wait for cookie to be set by browser
      // The Set-Cookie header processing may have a tiny delay
      await this._waitForCookieSet();
    } catch (error) {
      console.error('Failed to register M2M token:', error);
    }
  }

  private async _waitForCookieSet(maxRetries = 10, interval = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      if (this.getTokenStatusFromCookie() === 'active') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    // If cookie still not set after retries, continue anyway
    // The request might still work if the cookie was set but we couldn't detect it
    console.warn('Cookie may not be fully set, proceeding anyway');
  }

  private getTokenStatusFromCookie(): string | null {
    if (typeof document === 'undefined') return null;

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'mp_token_status') {
        return value;
      }
    }
    return null;
  }

  // ============================== Skills Market ==============================

  getSkillCategories = async (): Promise<SkillCategoryItem[]> => [];

  getSkillDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverSkillDetail> => {
    const { transformMarketSkillToDetail } = await import('@/services/market/transformers');
    const row = await lambdaClient.market.getSkillDetail.query({
      identifier: params.identifier,
    });
    if (!row) return undefined;
    return transformMarketSkillToDetail(row);
  };

  getSkillList = async (params: SkillQueryParams = {}): Promise<SkillListResponse> => {
    const { mapSkillSort, transformSkillListResponse } =
      await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;
    const shouldOmitCategory = ['all'].includes(params.category || '');

    const result = await lambdaClient.market.getSkillList.query({
      category: shouldOmitCategory ? undefined : params.category,
      keyword: params.q,
      page,
      pageSize,
      sortBy: mapSkillSort(params.sort),
    });

    return transformSkillListResponse(result, page, pageSize);
  };

  getMySkillList = async (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): Promise<SkillListResponse> => {
    const { transformSkillListResponse } = await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    const result = await communityApiService.getMySkillList({
      keyword: params.keyword,
      page,
      pageSize,
      sortBy: params.sortBy,
    });

    return transformSkillListResponse(result, page, pageSize);
  };

  getKnowledgeBaseList = async (
    params: KnowledgeBaseQueryParams = {},
  ): Promise<KnowledgeBaseListResponse> => {
    const { mapKnowledgeBaseSort, transformKnowledgeBaseListResponse } =
      await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    const result = await lambdaClient.market.getKnowledgeBaseList.query({
      keyword: params.q,
      page,
      pageSize,
      sortBy: mapKnowledgeBaseSort(params.sort),
    });

    return transformKnowledgeBaseListResponse(result as any, page, pageSize);
  };

  getMyKnowledgeBaseList = async (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): Promise<KnowledgeBaseListResponse> => {
    const { transformKnowledgeBaseListResponse } = await import('@/services/market/transformers');
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    const result = await communityApiService.getMyKnowledgeBaseList({
      keyword: params.keyword,
      page,
      pageSize,
      sortBy: params.sortBy,
    });

    return transformKnowledgeBaseListResponse(result as any, page, pageSize);
  };

  getKnowledgeBaseDetail = async (params: {
    identifier: string;
  }): Promise<DiscoverKnowledgeBaseDetail> => {
    const { transformMarketKnowledgeBaseToDetail } = await import('@/services/market/transformers');
    const row = await lambdaClient.market.getKnowledgeBaseDetail.query({
      identifier: params.identifier,
    });
    if (!row) throw new Error('Knowledge base not found');
    return transformMarketKnowledgeBaseToDetail(row as any);
  };

  reportSkillEvent = async (eventData: { event: string; identifier: string; source?: string }) => {
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());
    if (!allow) return;

    const payload = cleanObject({
      ...eventData,
      source: eventData.source ?? 'community/skill',
    });

    // Note: skill event reporting can be added when the backend supports it
    // Payload prepared for future backend integration
    void payload;
  };

  // ============================== Group Agent Market ==============================

  getGroupAgentCategories = async (): Promise<CategoryItem[]> => [];

  getGroupAgentDetail = async (): Promise<any> => undefined;

  getGroupAgentIdentifiers = async (): Promise<IdentifiersResponse> => ({ identifiers: [] });

  getGroupAgentList = async (): Promise<any> => ({
    currentPage: 1,
    items: [],
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
  });

  reportGroupAgentEvent = async (): Promise<void> => {};

  reportGroupAgentInstall = async (): Promise<void> => {};
}

export const discoverService = new DiscoverService();

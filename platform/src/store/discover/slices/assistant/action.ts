import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { discoverService } from '@/services/discover';
import { communityApiService } from '@/services/marketApi';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { useHomeStore } from '@/store/home';
import { type StoreSetter } from '@/store/types';
import {
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type IdentifiersResponse,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createAssistantSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new AssistantActionImpl(set, get, _api);

export class AssistantActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useAssistantCategories = (
    params: CategoryListQuery & { source?: AssistantMarketSource },
  ): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-categories', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => discoverService.getAssistantCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useAssistantDetail = (params: {
    identifier: string;
    source?: AssistantMarketSource;
    version?: string;
  }): SWRResponse<DiscoverAssistantDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-details', locale, params.identifier, params.version, params.source]
        .filter(Boolean)
        .join('-'),
      async () => discoverService.getAssistantDetail(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useAssistantIdentifiers = (params?: {
    source?: AssistantMarketSource;
  }): SWRResponse<IdentifiersResponse> => {
    return useSWR(
      ['assistant-identifiers', params?.source].filter(Boolean).join('-') ||
        'assistant-identifiers',
      async () => discoverService.getAssistantIdentifiers(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useAssistantList = (params: AssistantQueryParams = {}): SWRResponse<AssistantListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['assistant-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getAssistantList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useMyAssistantList = (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): SWRResponse<AssistantListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['my-assistant-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getMyAssistantList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  publishAgent = async (
    agentId: string,
    category: string,
    bundledSkillIdentifiers?: string[],
    bundledMcpIdentifiers?: string[],
    newDisplayName?: string,
  ) => {
    return communityApiService.publishAgent(
      agentId,
      bundledSkillIdentifiers,
      bundledMcpIdentifiers,
      undefined,
      newDisplayName,
      category,
    );
  };

  updateAgent = async (identifier: string) => {
    return communityApiService.updateAgent(identifier);
  };

  installAgent = async (identifier: string) => {
    const result = await communityApiService.installAgent(identifier);
    await useHomeStore.getState().refreshAgentList();
    return result;
  };

  updateInstalledAgent = async (identifier: string) => {
    const result = await communityApiService.updateInstalledAgent(identifier);
    await useHomeStore.getState().refreshAgentList();
    return result;
  };
}

export type AssistantAction = Pick<AssistantActionImpl, keyof AssistantActionImpl>;

import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { communityApiService } from '@/services/marketApi';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverKnowledgeBaseDetail,
  type KnowledgeBaseListResponse,
  type KnowledgeBaseQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;

export const createKnowledgeBaseSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new KnowledgeBaseActionImpl(set, get, _api);

export class KnowledgeBaseActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useFetchKnowledgeBaseList = (
    params: KnowledgeBaseQueryParams,
  ): SWRResponse<KnowledgeBaseListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['knowledge-base-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getKnowledgeBaseList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
    );
  };

  useFetchKnowledgeBaseDetail = ({
    identifier,
  }: {
    identifier?: string;
  }): SWRResponse<DiscoverKnowledgeBaseDetail> => {
    const locale = globalHelpers.getCurrentLanguage();

    return useClientDataSWR(
      !identifier ? null : ['knowledge-base-detail', locale, identifier].join('-'),
      async () => discoverService.getKnowledgeBaseDetail({ identifier: identifier! }),
    );
  };

  useMyKnowledgeBaseList = (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): SWRResponse<KnowledgeBaseListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['my-knowledge-base-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getMyKnowledgeBaseList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  publishKnowledgeBase = async (knowledgeBaseId: string) =>
    communityApiService.publishKnowledgeBase(knowledgeBaseId);

  updateKnowledgeBase = async (identifier: string) =>
    communityApiService.updateKnowledgeBase(identifier);

  installKnowledgeBase = async (identifier: string) =>
    communityApiService.installKnowledgeBase(identifier);

  updateInstalledKnowledgeBase = async (identifier: string) =>
    communityApiService.updateInstalledKnowledgeBase(identifier);
}

export type KnowledgeBaseAction = Pick<KnowledgeBaseActionImpl, keyof KnowledgeBaseActionImpl>;

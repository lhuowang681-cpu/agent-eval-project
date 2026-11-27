import { type CategoryItem, type CategoryListQuery } from '@lobehub/market-sdk';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { communityApiService } from '@/services/marketApi';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverMcpDetail,
  type McpListResponse,
  type McpQueryParams,
} from '@/types/discover';

type Setter = StoreSetter<DiscoverStore>;
export const createMCPSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new MCPActionImpl(set, get, _api);

export class MCPActionImpl {
  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  useFetchMcpDetail = ({
    identifier,
    version,
  }: {
    identifier?: string;
    version?: string;
  }): SWRResponse<DiscoverMcpDetail> => {
    const locale = globalHelpers.getCurrentLanguage();

    return useClientDataSWR(
      !identifier ? null : ['mcp-detail', locale, identifier, version].filter(Boolean).join('-'),
      async () => discoverService.getMcpDetail({ identifier: identifier!, version }),
    );
  };

  useFetchMcpList = (params: McpQueryParams): SWRResponse<McpListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['mcp-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getMcpList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
    );
  };

  useMyMcpList = (
    params: {
      keyword?: string;
      page?: number;
      pageSize?: number;
      sortBy?: 'recommended' | 'installCount' | 'updatedAt';
    } = {},
  ): SWRResponse<McpListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useSWR(
      ['my-mcp-list', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () =>
        discoverService.getMyMcpList({
          ...params,
          page: params.page ? Number(params.page) : 1,
          pageSize: params.pageSize ? Number(params.pageSize) : 21,
        }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useMcpCategories = (params: CategoryListQuery): SWRResponse<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return useClientDataSWR(
      ['mcp-categories', locale, ...Object.values(params)].join('-'),
      async () => discoverService.getMcpCategories(params),
      {
        revalidateOnFocus: false,
      },
    );
  };

  publishMcp = async (
    identifier: string,
    manifest: Record<string, unknown>,
    customParams: Record<string, unknown>,
    category: string,
    newDisplayName?: string,
  ) => communityApiService.publishMcp(identifier, manifest, customParams, category, newDisplayName);

  updateMcp = async (identifier: string) => communityApiService.updateMcp(identifier);

  installMcp = async (identifier: string) => communityApiService.installMcp(identifier);

  updateInstalledMcp = async (identifier: string) =>
    communityApiService.updateInstalledMcp(identifier);
}

export type MCPAction = Pick<MCPActionImpl, keyof MCPActionImpl>;

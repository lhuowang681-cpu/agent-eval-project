import { isEqual } from 'es-toolkit';
import { shallow } from 'zustand/shallow';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { resourceService } from '@/services/resource';
import { type ResourceItem, type ResourceQueryParams } from '@/types/resource';

import { useFileStore } from '../../store';
import { getResourceQueryKey } from './queryKey';

const SWR_KEY_RESOURCES = 'SWR_RESOURCES';

/**
 * Revalidate resources with current or specific query params
 * This can be called from outside React components (e.g., store actions)
 */
export const revalidateResources = async (params?: ResourceQueryParams) => {
  if (params) {
    await mutate([SWR_KEY_RESOURCES, params]);
    return;
  }

  await mutate((key) => Array.isArray(key) && key[0] === SWR_KEY_RESOURCES);
};

/**
 * Custom SWR hook for fetching resources with caching and revalidation
 */
export const useFetchResources = (params: ResourceQueryParams | null, enable: any = true) => {
  const queryKey = getResourceQueryKey(params);

  return useClientDataSWR(
    enable && params ? [SWR_KEY_RESOURCES, params] : null,
    async ([, queryParams]: [string, ResourceQueryParams]) => {
      const response = await resourceService.queryResources({
        ...queryParams,
        limit: queryParams.limit || 50,
        offset: 0,
      });
      return response;
    },
    {
      // SWR configuration for optimal UX
      dedupingInterval: 100,
      onSuccess: (data: { hasMore: boolean; items: ResourceItem[]; total?: number }) => {
        const { resourceDataMap, resourceMap } = useFileStore.getState();

        const newResourceList = data.items;
        const newResourceMap = new Map(resourceMap);
        for (const item of data.items) {
          newResourceMap.set(item.id, item);
        }

        const currentData = resourceDataMap[queryKey];
        const resourceChanged =
          !currentData ||
          !isEqual(newResourceList, currentData.items) ||
          currentData.hasMore !== data.hasMore ||
          currentData.total !== data.total;

        useFileStore.setState(
          {
            activeResourceKey: queryKey,
            hasMore: data.hasMore,
            offset: data.items.length,
            queryParams: params ?? undefined,
            ...(resourceChanged && {
              resourceDataMap: {
                ...resourceDataMap,
                [queryKey]: {
                  hasMore: data.hasMore,
                  items: newResourceList,
                  offset: data.items.length,
                  queryParams: params!,
                  total: data.total,
                },
              },
              resourceList: newResourceList,
            }),
            resourceMap: newResourceMap,
            total: data.total,
          },
          false,
          'useFetchResources/success',
        );
      },
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );
};

export const useResourceData = (params: ResourceQueryParams | null) => {
  const queryKey = getResourceQueryKey(params);

  return useFileStore((s) => (queryKey ? s.resourceDataMap[queryKey] : undefined), shallow);
};

/**
 * Hook to access resource store state
 */
export const useResourceStore = () => {
  return useFileStore(
    (s) => ({
      hasMore: s.hasMore,
      queryParams: s.queryParams,
      resourceList: s.resourceList,
      resourceMap: s.resourceMap,
      total: s.total,
    }),
    shallow,
  );
};

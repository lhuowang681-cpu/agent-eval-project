'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { type McpQueryParams } from '@/types/discover';
import { DiscoverTab, McpSorts } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const McpPage = memo(() => {
  const queryParams = useQuery() as McpQueryParams & { mine?: string };
  const { q, page, category, sort, order, connectionType, mine } = queryParams;
  const isMine = mine === 'true';
  const isLogin = useUserStore(authSelectors.isLogin);

  const useFetchMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const useMyMcpList = useDiscoverStore((s) => s.useMyMcpList);

  // Both hooks must be called unconditionally (React Hooks rule)
  const publicListResult = useFetchMcpList({
    category,
    connectionType,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? McpSorts.Recommended,
  });

  const myListResult = useMyMcpList({
    keyword: q as string | undefined,
    page: page ? Number(page) : 1,
    pageSize: 21,
    sortBy:
      sort === McpSorts.InstallCount
        ? 'installCount'
        : sort === McpSorts.UpdatedAt
          ? 'updatedAt'
          : sort === McpSorts.CreatedAt
            ? 'createdAt'
            : undefined,
  });

  // Use my list when filter is active and user is logged in
  const { data, isLoading } = isMine && isLogin ? myListResult : publicListResult;

  if ((isLoading && !data) || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  return (
    <Flexbox gap={32} width={'100%'}>
      <List data={items} />
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.Mcp}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default McpPage;

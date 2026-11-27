'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { type AssistantQueryParams } from '@/types/discover';
import { AssistantSorts, DiscoverTab } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const AssistantPage = memo(() => {
  const { q, page, category, sort, order, source, mine } = useQuery() as AssistantQueryParams & {
    mine?: string;
  };
  const isMine = mine === 'true';
  const isLogin = useUserStore(authSelectors.isLogin);

  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useMyAssistantList = useDiscoverStore((s) => s.useMyAssistantList);

  // Both hooks must be called unconditionally (React Hooks rule)
  const publicListResult = useAssistantList({
    category,
    includeAgentGroup: true,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? AssistantSorts.Recommended,
    source,
  });

  const myListResult = useMyAssistantList({
    keyword: q as string | undefined,
    page: page ? Number(page) : 1,
    pageSize: 21,
    sortBy:
      sort === AssistantSorts.MostUsage
        ? 'installCount'
        : sort === AssistantSorts.UpdatedAt
          ? 'updatedAt'
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
        tab={DiscoverTab.Assistants}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default AssistantPage;

'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { DiscoverTab, type KnowledgeBaseQueryParams, KnowledgeBaseSorts } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const KnowledgeBasePage = memo(() => {
  const queryParams = useQuery() as KnowledgeBaseQueryParams & { mine?: string };
  const { q, page, sort, order, mine } = queryParams;
  const isMine = mine === 'true';
  const isLogin = useUserStore(authSelectors.isLogin);

  const useFetchKnowledgeBaseList = useDiscoverStore((s) => s.useFetchKnowledgeBaseList);
  const useMyKnowledgeBaseList = useDiscoverStore((s) => s.useMyKnowledgeBaseList);

  const publicListResult = useFetchKnowledgeBaseList({
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? KnowledgeBaseSorts.InstallCount,
  });

  const myListResult = useMyKnowledgeBaseList({
    keyword: q as string | undefined,
    page: page ? Number(page) : 1,
    pageSize: 21,
    sortBy:
      sort === KnowledgeBaseSorts.InstallCount
        ? 'installCount'
        : sort === KnowledgeBaseSorts.UpdatedAt
          ? 'updatedAt'
          : undefined,
  });

  const { data, isLoading } = isMine && isLogin ? myListResult : publicListResult;

  if (isLoading || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  return (
    <Flexbox gap={32} width={'100%'}>
      <List data={items} />
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.KnowledgeBases}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default KnowledgeBasePage;

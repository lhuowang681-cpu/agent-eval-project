'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { type SkillQueryParams } from '@/types/discover';
import { DiscoverTab, SkillSorts } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const SkillPage = memo(() => {
  const queryParams = useQuery() as SkillQueryParams & { mine?: string };
  const { q, page, category, sort, order, mine } = queryParams;
  const isMine = mine === 'true';
  const isLogin = useUserStore(authSelectors.isLogin);

  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const useMySkillList = useDiscoverStore((s) => s.useMySkillList);

  // Both hooks must be called unconditionally (React Hooks rule)
  const publicListResult = useFetchSkillList({
    category,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? SkillSorts.InstallCount,
  });

  const myListResult = useMySkillList({
    keyword: q as string | undefined,
    page: page ? Number(page) : 1,
    pageSize: 21,
    sortBy:
      sort === SkillSorts.InstallCount
        ? 'installCount'
        : sort === SkillSorts.UpdatedAt
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
        tab={DiscoverTab.Skills}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default SkillPage;

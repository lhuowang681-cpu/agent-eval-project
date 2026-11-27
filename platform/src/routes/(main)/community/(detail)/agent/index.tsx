'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { type AssistantMarketSource } from '@/types/discover';

import NotFound from '../components/NotFound';
import { TocProvider } from '../features/Toc/useToc';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';
import StatusPage from './features/StatusPage';
import Loading from './loading';

interface AssistantDetailPageProps {
  mobile?: boolean;
}

const AssistantDetailPage = memo<AssistantDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');
  const { version, source } = useQuery() as { source?: AssistantMarketSource; version?: string };

  const useAssistantDetail = useDiscoverStore((s) => s.useAssistantDetail);
  const { data, isLoading, mutate } = useAssistantDetail({ identifier, source, version });
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore((s) => s.user?.id);

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  // 检查助理状态 - 发布者可以查看自己下线的助理
  const status = (data as any)?.status;
  const isPublisher = isLogin && currentUserId && currentUserId === (data as any)?.publisherId;
  if (
    !isPublisher &&
    (status === 'unpublished' || status === 'archived' || status === 'deprecated')
  ) {
    return <StatusPage status={status} />;
  }

  return (
    <TocProvider>
      <DetailProvider config={{ ...data, mutate }}>
        <Flexbox data-testid="assistant-detail-content" gap={16}>
          <Header mobile={mobile} />
          <Details mobile={mobile} />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export const MobileDiscoverAssistantDetailPage = memo<{ mobile?: boolean }>(() => {
  return <AssistantDetailPage mobile={true} />;
});

export default AssistantDetailPage;

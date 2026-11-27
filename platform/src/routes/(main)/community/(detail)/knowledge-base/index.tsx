'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';
import Loading from './loading';

interface KnowledgeBaseDetailPageProps {
  mobile?: boolean;
}

const KnowledgeBaseDetailPage = memo<KnowledgeBaseDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = params.slug ?? '';

  const useKnowledgeBaseDetail = useDiscoverStore((s) => s.useFetchKnowledgeBaseDetail);
  const { data, isLoading, mutate } = useKnowledgeBaseDetail({ identifier });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <DetailProvider config={{ ...data, mutate }}>
      <Flexbox data-testid="knowledge-base-detail-content" gap={16}>
        <Header mobile={mobile} />
        <Details mobile={mobile} />
      </Flexbox>
    </DetailProvider>
  );
});

export const MobileKnowledgeBasePage = memo(() => {
  return <KnowledgeBaseDetailPage mobile={true} />;
});

export default KnowledgeBaseDetailPage;

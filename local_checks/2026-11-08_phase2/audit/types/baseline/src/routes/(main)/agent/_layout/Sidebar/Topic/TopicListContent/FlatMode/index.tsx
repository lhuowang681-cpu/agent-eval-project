'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import TopicItem from '../../List/Item';

const FlatMode = memo(() => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const [activeTopicId, activeThreadId, hasMore, isExpandingPageSize] = useChatStore((s) => [
    s.activeTopicId,
    s.activeThreadId,
    topicSelectors.hasMoreTopicsForSidebar(s),
    topicSelectors.isExpandingPageSize(s),
  ]);

  const activeTopicList = useChatStore(
    topicSelectors.displayTopicsForSidebar(topicPageSize),
    isEqual,
  );

  return (
    <Flexbox gap={1}>
      {activeTopicList?.map((topic) => (
        <TopicItem
          active={activeTopicId === topic.id}
          fav={topic.favorite}
          id={topic.id}
          key={topic.id}
          metadata={topic.metadata}
          status={topic.status}
          threadId={activeThreadId}
          title={topic.title}
        />
      ))}
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && activeAgentId && (
        <NavItem
          icon={MoreHorizontal}
          title={t('loadMore')}
          onClick={() => navigate(urlJoin('/agent', activeAgentId, 'topics'))}
        />
      )}
    </Flexbox>
  );
});

FlatMode.displayName = 'FlatMode';

export default FlatMode;

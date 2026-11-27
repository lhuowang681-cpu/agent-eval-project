'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
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
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import GroupItem from './GroupItem';

const ByTimeMode = memo(() => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicDisplayMode = useUserStore(preferenceSelectors.topicDisplayMode);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const [hasMore, isExpandingPageSize] = useChatStore((s) => [
    topicSelectors.hasMoreTopicsForSidebar(s),
    topicSelectors.isExpandingPageSize(s),
  ]);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);

  const groupSelector = useMemo(
    () => topicSelectors.groupedTopicsForSidebar(topicPageSize, topicDisplayMode),
    [topicPageSize, topicDisplayMode],
  );
  const groupTopics = useChatStore(groupSelector, isEqual);

  const [topicGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicGroupKeys(s),
    s.updateSystemStatus,
  ]);

  useEffect(() => {
    updateSystemStatus({ expandTopicGroupKeys: undefined });
  }, [topicDisplayMode, updateSystemStatus]);

  const expandedKeys = useMemo(() => {
    return topicGroupKeys || groupTopics.map((group) => group.id);
  }, [topicGroupKeys, groupTopics]);

  return (
    <Flexbox gap={2}>
      <Accordion
        expandedKeys={expandedKeys}
        gap={2}
        onExpandedChange={(keys) => updateSystemStatus({ expandTopicGroupKeys: keys as any })}
      >
        {groupTopics.map((group) => (
          <GroupItem
            activeThreadId={activeThreadId}
            activeTopicId={activeTopicId}
            group={group}
            key={group.id}
          />
        ))}
      </Accordion>
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

ByTimeMode.displayName = 'ByTimeMode';

export default ByTimeMode;

'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { MessageSquarePlusIcon, MessagesSquareIcon, RadioTowerIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const Nav = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const params = useParams();
  const agentId = params.aid;
  const pathname = usePathname();
  const isProfileActive = pathname.includes('/profile');
  const isIntegrationActive = pathname.includes('/channel');
  const isTopicsActive = pathname.endsWith('/topics');
  const router = useQueryRoute();
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const hideProfile = !isAgentEditable;
  const switchTopic = useChatStore((s) => s.switchTopic);
  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);

  const isTaskActive = pathname.includes('/task/');

  const { mutate } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);
  const handleNewTopic = () => {
    if ((isProfileActive || isIntegrationActive || isTaskActive || isTopicsActive) && agentId) {
      router.push(urlJoin('/agent', agentId));
    }
    mutate();
  };

  return (
    <Flexbox gap={1} paddingInline={4}>
      <NavItem
        data-testid={'agent-new-topic'}
        icon={MessageSquarePlusIcon}
        title={tTopic('actions.addNewTopic')}
        onClick={handleNewTopic}
      />
      {!hideProfile && (
        <NavItem
          active={isProfileActive}
          icon={BotPromptIcon}
          title={t('tab.profile')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'profile'));
          }}
        />
      )}
      <NavItem
        active={isTopicsActive}
        icon={MessagesSquareIcon}
        title={tTopic('management.sidebarEntry')}
        onClick={() => {
          switchTopic(null, { skipRefreshMessage: true });
          router.push(urlJoin('/agent', agentId!, 'topics'));
        }}
      />
      {!hideProfile && (
        <NavItem
          active={isIntegrationActive}
          icon={RadioTowerIcon}
          title={t('tab.integration')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'channel'));
          }}
        />
      )}
      {/* <NavItem
        icon={SearchIcon}
        title={t('tab.search')}
        onClick={() => {
          toggleCommandMenu(true);
        }}
      /> */}
    </Flexbox>
  );
});

export default Nav;

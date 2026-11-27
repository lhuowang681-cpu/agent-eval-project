'use client';

import isEqual from 'fast-deep-equal';
import { MessageSquareHeartIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import {
  AgentSettings as Settings,
  SettingsModalLayout,
  type SettingsModalTabItem,
} from '@/features/AgentSetting';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

const TAB_META = {
  [ChatSettingsTabs.Opening]: { icon: MessageSquareHeartIcon, labelKey: 'agentTab.opening' },
} as const;

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const [agentId, isInbox] = useAgentStore(
    (s) => [s.activeAgentId, builtinAgentSelectors.isInboxAgent(s)],
    shallow,
  );
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const [tab, setTab] = useState(ChatSettingsTabs.Opening);

  const updateAgentConfig = async (config: any) => {
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, config);
  };

  const updateAgentMeta = async (meta: any) => {
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, meta);
  };

  const availableTabs = useMemo(() => [ChatSettingsTabs.Opening], []);

  const tabs: SettingsModalTabItem[] = useMemo(
    () =>
      availableTabs.map((key) => {
        const entry = TAB_META[key as keyof typeof TAB_META];
        return { icon: entry.icon, key, label: t(entry.labelKey) };
      }),
    [availableTabs, t],
  );

  const displayTitle = isInbox
    ? 'TripYoYo AI'
    : meta.title || t('defaultSession', { ns: 'common' });

  return (
    <SettingsModalLayout
      activeTab={tab}
      avatar={isInbox ? DEFAULT_INBOX_AVATAR : meta.avatar || DEFAULT_AVATAR}
      background={meta.backgroundColor || undefined}
      tabs={tabs}
      title={displayTitle}
      onTabChange={(key) => setTab(key as ChatSettingsTabs)}
    >
      <Settings
        config={config}
        id={agentId}
        loading={false}
        meta={meta}
        tab={tab}
        onConfigChange={updateAgentConfig}
        onMetaChange={updateAgentMeta}
      />
    </SettingsModalLayout>
  );
});

export default Content;

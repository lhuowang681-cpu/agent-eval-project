import { type ReactNode } from 'react';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

import AgentDocuments from './AgentDocuments';
import AgentMeta from './AgentMeta';
import AgentOpening from './AgentOpening';
import AgentPlugin from './AgentPlugin';
import AgentTTS from './AgentTTS';

export interface AgentSettingsContentProps {
  loadingSkeleton: ReactNode;
  tab: ChatSettingsTabs;
}

const AgentSettingsContent = memo<AgentSettingsContentProps>(({ tab, loadingSkeleton }) => {
  const loading = useAgentStore(agentSelectors.isAgentConfigLoading);

  if (loading) return loadingSkeleton;

  return (
    <>
      {tab === ChatSettingsTabs.Meta && <AgentMeta />}
      {tab === ChatSettingsTabs.Documents && <AgentDocuments />}
      {tab === ChatSettingsTabs.Opening && <AgentOpening />}
      {tab === ChatSettingsTabs.Plugin && <AgentPlugin />}
      {tab === ChatSettingsTabs.TTS && <AgentTTS />}
    </>
  );
});

export default AgentSettingsContent;

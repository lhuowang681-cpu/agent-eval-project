'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AgentCronJobs from '../AgentCronJobs';
import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentKnowledge from './AgentKnowledge';
import AgentTool from './AgentTool';

const styles = createStaticStyles(({ css }) => ({
  configLabel: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  configPanel: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  topArea: css`
    cursor: default;
    margin-block-end: 16px;
  `,
}));

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  return (
    <>
      <Flexbox
        className={styles.topArea}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        {/* Config Bar: Model Selector + Tools + Knowledge */}
        <Flexbox className={styles.configPanel} gap={10}>
          <div className={styles.configLabel}>{t('settingAgent.runtimeConfig.title')}</div>
          <Flexbox horizontal align={'center'} gap={12} justify={'flex-start'} wrap={'wrap'}>
            <ModelSelect
              initialWidth
              popupWidth={400}
              value={{
                model: config.model,
                provider: config.provider,
              }}
              onChange={updateConfig}
            />
            <AgentTool />
          </Flexbox>
          <AgentKnowledge />
        </Flexbox>
      </Flexbox>
      {/* Main Content: Prompt Editor */}
      <EditorCanvas />
      {/* Agent Cron Jobs Display (only show if jobs exist) */}
      {enableBusinessFeatures && <AgentCronJobs />}
    </>
  );
});

export default ProfileEditor;

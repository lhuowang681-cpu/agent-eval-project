'use client';

import { Button, Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { LibraryBig, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RepoIcon from '@/components/LibIcon';
import { AttachKnowledgeModal } from '@/features/LibraryModal';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

export interface AgentKnowledgeProps {
  agentId?: string;
}

const AgentKnowledge = memo<AgentKnowledgeProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const effectiveAgentId = agentId || activeAgentId || '';
  const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);

  const knowledgeBases = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(effectiveAgentId)(s),
    isEqual,
  );
  const removeKnowledgeBaseFromAgent = useAgentStore((s) => s.removeKnowledgeBaseFromAgent);
  const [modalOpen, setModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!enableKnowledgeBase) return null;

  const enabledKnowledgeBases = knowledgeBases.filter((kb) => kb.enabled !== false);

  return (
    <>
      <Flexbox horizontal align="center" gap={8} wrap={'wrap'}>
        <Button
          icon={PlusIcon}
          loading={updating}
          size={'small'}
          style={{ color: cssVar.colorTextSecondary }}
          type={'text'}
          onClick={() => setModalOpen(true)}
        >
          {t('knowledge.add', { defaultValue: 'Library' })}
        </Button>
        {enabledKnowledgeBases.map((kb) => (
          <Tag
            closable
            icon={<RepoIcon size={14} />}
            key={kb.id}
            onClose={async (e) => {
              e.preventDefault();
              setUpdating(true);
              try {
                await removeKnowledgeBaseFromAgent(kb.id);
              } finally {
                setUpdating(false);
              }
            }}
          >
            {kb.name}
          </Tag>
        ))}
        {enabledKnowledgeBases.length === 0 && (
          <Button
            icon={LibraryBig}
            size={'small'}
            style={{ color: cssVar.colorTextTertiary }}
            type={'text'}
            onClick={() => setModalOpen(true)}
          >
            {t('knowledge.empty', { defaultValue: 'Add knowledge library' })}
          </Button>
        )}
      </Flexbox>
      <AttachKnowledgeModal librariesOnly open={modalOpen} setOpen={setModalOpen} />
    </>
  );
});

AgentKnowledge.displayName = 'AgentKnowledge';

export default AgentKnowledge;

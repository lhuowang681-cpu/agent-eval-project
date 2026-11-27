'use client';

import { App, Modal, Typography } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { communityApiService } from '@/services/marketApi';

import { PublishRenameModal } from './PublishRenameModal';

interface KnowledgeBasePublishModalProps {
  excludeMarketIdentifier?: string | null;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
}

export const KnowledgeBasePublishModal = memo<KnowledgeBasePublishModalProps>(
  ({ open, onClose, knowledgeBaseId, knowledgeBaseName, excludeMarketIdentifier, onSuccess }) => {
    const { t } = useTranslation('discover');
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);

    const doPublish = async (newDisplayName?: string) => {
      setLoading(true);
      try {
        await communityApiService.publishKnowledgeBase(knowledgeBaseId, newDisplayName);
        message.success(t('knowledgeBases.publishSuccess'));
        setRenameOpen(false);
        onSuccess?.();
        onClose();
      } catch (error) {
        console.error(error);
        message.error(t('fork.failed'));
      } finally {
        setLoading(false);
      }
    };

    const handlePublish = async () => {
      const conflict = await communityApiService.checkKnowledgeBasePublishNameConflict(
        knowledgeBaseName,
        excludeMarketIdentifier ?? undefined,
      );
      if (conflict.conflict) {
        setRenameOpen(true);
        return;
      }
      await doPublish();
    };

    return (
      <>
        <Modal
          confirmLoading={loading}
          open={open}
          title={t('knowledgeBases.publishToMarket', { title: knowledgeBaseName })}
          onCancel={onClose}
          onOk={handlePublish}
        >
          <Typography.Paragraph type="secondary">
            {t('knowledgeBases.publishDescription')}
          </Typography.Paragraph>
        </Modal>
        <PublishRenameModal
          currentName={knowledgeBaseName}
          open={renameOpen}
          toolType="knowledgeBase"
          onCancel={() => setRenameOpen(false)}
          onConfirm={async (newName) => {
            const recheck = await communityApiService.checkKnowledgeBasePublishNameConflict(
              newName,
              excludeMarketIdentifier ?? undefined,
            );
            if (recheck.conflict) {
              message.error(t('publishRename.sameName'));
              return;
            }
            await doPublish(newName);
          }}
        />
      </>
    );
  },
);

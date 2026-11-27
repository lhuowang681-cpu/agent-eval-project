'use client';

import { App, Input, Modal, Typography } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type MarketPublishToolType = 'agent' | 'skill' | 'mcp' | 'knowledgeBase';

interface PublishRenameModalProps {
  currentName: string;
  onCancel: () => void;
  onConfirm: (newName: string) => Promise<void>;
  open: boolean;
  toolType: MarketPublishToolType;
}

export const PublishRenameModal = memo<PublishRenameModalProps>(
  ({ open, onCancel, onConfirm, currentName, toolType }) => {
    const { t } = useTranslation('discover');
    const { message } = App.useApp();
    const [name, setName] = useState(currentName);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (open) setName(currentName);
    }, [open, currentName]);

    const handleConfirm = async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        message.error(t('publishRename.required'));
        return;
      }
      if (trimmed.toLowerCase() === currentName.trim().toLowerCase()) {
        message.error(t('publishRename.sameName'));
        return;
      }

      setLoading(true);
      try {
        await onConfirm(trimmed);
      } finally {
        setLoading(false);
      }
    };

    return (
      <Modal
        confirmLoading={loading}
        open={open}
        title={t('publishRename.title', { toolType: t(`publishRename.toolType.${toolType}`) })}
        onCancel={onCancel}
        onOk={handleConfirm}
      >
        <Typography.Paragraph type="secondary">
          {t('publishRename.description', { name: currentName })}
        </Typography.Paragraph>
        <Input
          placeholder={t('publishRename.placeholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Modal>
    );
  },
);

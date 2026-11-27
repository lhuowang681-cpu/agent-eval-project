'use client';

import { Button, Flexbox, Modal, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFeishuAuthorize } from './useFeishuAuthorize';

interface FeishuAuthModalProps {
  authUrl: string;
  onAuthorized: (token: string) => void | Promise<void>;
  onClose: () => void;
  open: boolean;
}

const FeishuAuthModal = memo<FeishuAuthModalProps>(({ authUrl, onAuthorized, onClose, open }) => {
  const { t } = useTranslation('feishuAuth');
  const { authorize, error, isAuthorizing } = useFeishuAuthorize();

  const handleAuthorize = async () => {
    const token = await authorize(authUrl);
    if (!token) return;

    await onAuthorized(token);
  };

  return (
    <Modal
      cancelText={t('modal.cancel')}
      open={open}
      title={t('modal.title')}
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={onClose}>{t('modal.cancel')}</Button>
          <Button loading={isAuthorizing} type="primary" onClick={handleAuthorize}>
            {isAuthorizing ? t('authorizing') : t('authorize')}
          </Button>
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={8}>
        <Text>{t('modal.description')}</Text>
        {error && <Text type="danger">{t('error')}</Text>}
      </Flexbox>
    </Modal>
  );
});

FeishuAuthModal.displayName = 'FeishuAuthModal';

export default FeishuAuthModal;

'use client';

import { Button, Input, Modal, Text } from '@lobehub/ui';
import { Copy } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ShareResultModalProps {
  onClose: () => void;
  onCopy: () => Promise<void>;
  open: boolean;
  url: string;
}

const ShareResultModal = memo<ShareResultModalProps>(({ onClose, onCopy, open, url }) => {
  const { t } = useTranslation('share');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      centered
      cancelText={t('button.done')}
      footer={null}
      open={open}
      title={t('result.title')}
      width={520}
      onCancel={onClose}
    >
      <Text fontSize={14} type={'secondary'}>
        {t('result.message')}
      </Text>
      <div style={{ marginTop: 16 }}>
        <Text fontSize={13} type={'secondary'}>
          {t('result.linkLabel')}
        </Text>
        <Input
          readOnly
          style={{ marginTop: 8 }}
          value={url}
          suffix={
            <Button icon={Copy} size={'small'} type={'text'} onClick={handleCopy}>
              {copied ? t('result.copied') : t('button.copy')}
            </Button>
          }
        />
      </div>
    </Modal>
  );
});

export default ShareResultModal;

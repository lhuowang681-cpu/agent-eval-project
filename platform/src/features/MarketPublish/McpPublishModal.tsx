'use client';

import { App, Modal, Typography } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketPublishFormFields from '@/features/MarketPublish/MarketPublishFormFields';
import { isPublishDisplayNameChanged } from '@/features/MarketPublish/publishDisplayName';
import { PublishRenameModal } from '@/features/MarketPublish/PublishRenameModal';
import { communityApiService } from '@/services/marketApi';

interface McpPublishModalProps {
  customParams: Record<string, unknown>;
  displayName: string;
  identifier: string;
  installedFromMarket?: boolean;
  manifest: Record<string, unknown>;
  marketSourceName?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
}

export const McpPublishModal = memo<McpPublishModalProps>(
  ({
    open,
    onClose,
    identifier,
    displayName: initialDisplayName,
    manifest,
    customParams,
    onSuccess,
    installedFromMarket = false,
    marketSourceName,
  }) => {
    const { t } = useTranslation('discover');
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [category, setCategory] = useState<string>();
    const [displayName, setDisplayName] = useState(initialDisplayName);
    const [renameOpen, setRenameOpen] = useState(false);

    const requiresRename = installedFromMarket;
    const referenceName = marketSourceName || initialDisplayName;

    useEffect(() => {
      if (open) setDisplayName(initialDisplayName);
    }, [initialDisplayName, open]);

    const doPublish = async (newDisplayName?: string) => {
      if (!category) {
        message.error(t('publish.category.required'));
        return;
      }

      const finalName = (newDisplayName ?? displayName).trim();
      if (!finalName) {
        message.error(t('publish.displayName.required'));
        return;
      }

      if (requiresRename && !isPublishDisplayNameChanged(finalName, referenceName)) {
        message.error(t('publish.displayName.mustDiffer', { name: referenceName }));
        return;
      }

      setLoading(true);
      try {
        const useNewName = finalName !== initialDisplayName.trim() ? finalName : undefined;
        await communityApiService.publishMcp(
          identifier,
          manifest,
          customParams,
          category,
          useNewName,
        );
        message.success(t('mcp.publishSuccess'));
        onSuccess?.();
        setRenameOpen(false);
        onClose();
      } catch (error) {
        console.error(error);
        message.error(t('mcp.publishFailed'));
      } finally {
        setLoading(false);
      }
    };

    const handlePublish = async () => {
      if (!category) {
        message.error(t('publish.category.required'));
        return;
      }

      const finalName = displayName.trim();
      const conflict = await communityApiService.checkMcpPublishNameConflict(finalName);
      if (conflict.conflict) {
        setRenameOpen(true);
        return;
      }
      await doPublish();
    };

    return (
      <>
        <Modal
          destroyOnHidden
          confirmLoading={loading}
          open={open}
          title={t('mcp.publishToMarket', { title: initialDisplayName })}
          onCancel={onClose}
          onOk={handlePublish}
        >
          <Typography.Paragraph type="secondary">
            {t('mcp.publishDescription')}
          </Typography.Paragraph>
          <MarketPublishFormFields
            category={category}
            displayName={displayName}
            marketSourceName={referenceName}
            resourceType="mcp"
            showDisplayName={requiresRename}
            onCategoryChange={setCategory}
            onDisplayNameChange={setDisplayName}
          />
        </Modal>

        <PublishRenameModal
          currentName={displayName}
          open={renameOpen}
          toolType="mcp"
          onCancel={() => setRenameOpen(false)}
          onConfirm={async (newName) => {
            const recheck = await communityApiService.checkMcpPublishNameConflict(newName);
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

McpPublishModal.displayName = 'McpPublishModal';

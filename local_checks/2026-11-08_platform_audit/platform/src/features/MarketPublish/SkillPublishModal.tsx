'use client';

import { App, Modal, Typography } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketPublishFormFields from '@/features/MarketPublish/MarketPublishFormFields';
import { MarketSkillSecurityScanModal } from '@/features/MarketPublish/MarketSkillSecurityScanModal';
import { isPublishDisplayNameChanged } from '@/features/MarketPublish/publishDisplayName';
import { PublishRenameModal } from '@/features/MarketPublish/PublishRenameModal';
import { translateSkillImportError } from '@/features/SkillStore/SkillList/skillImportError';
import { communityApiService } from '@/services/marketApi';

interface SkillPublishModalProps {
  installedFromMarket?: boolean;
  marketSourceName?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
  skillId: string;
  skillName: string;
}

export const SkillPublishModal = memo<SkillPublishModalProps>(
  ({
    open,
    onClose,
    skillId,
    skillName,
    onSuccess,
    installedFromMarket = false,
    marketSourceName,
  }) => {
    const { t } = useTranslation('discover');
    const { t: tSetting } = useTranslation('setting');
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [category, setCategory] = useState<string>();
    const [displayName, setDisplayName] = useState(skillName);
    const [renameOpen, setRenameOpen] = useState(false);
    const [securityScanOpen, setSecurityScanOpen] = useState(false);
    const [securityScanError, setSecurityScanError] = useState<string | null>(null);

    const requiresRename = installedFromMarket;
    const referenceName = marketSourceName || skillName;

    useEffect(() => {
      if (open) setDisplayName(skillName);
    }, [open, skillName]);

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
      setSecurityScanError(null);
      setSecurityScanOpen(true);
      try {
        const useNewName = finalName !== skillName.trim() ? finalName : undefined;
        await communityApiService.publishSkill(skillId, category, useNewName);
        setSecurityScanOpen(false);
        message.success(t('skills.publishSuccess'));
        onSuccess?.();
        setRenameOpen(false);
        onClose();
      } catch (error) {
        console.error(error);
        setSecurityScanError(translateSkillImportError(tSetting, error));
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
      const conflict = await communityApiService.checkSkillPublishNameConflict(finalName);
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
          closable={!loading}
          confirmLoading={loading}
          keyboard={!loading}
          maskClosable={!loading}
          open={open}
          title={t('skills.publishToMarket', { title: skillName })}
          onOk={handlePublish}
          onCancel={() => {
            if (!loading) onClose();
          }}
        >
          <Typography.Paragraph type="secondary">
            {t('skills.publishDescription')}
          </Typography.Paragraph>
          <MarketPublishFormFields
            category={category}
            displayName={displayName}
            marketSourceName={referenceName}
            resourceType="skill"
            showDisplayName={requiresRename}
            onCategoryChange={setCategory}
            onDisplayNameChange={setDisplayName}
          />
        </Modal>

        <PublishRenameModal
          currentName={displayName}
          open={renameOpen}
          toolType="skill"
          onCancel={() => setRenameOpen(false)}
          onConfirm={async (newName) => {
            const recheck = await communityApiService.checkSkillPublishNameConflict(newName);
            if (recheck.conflict) {
              message.error(t('publishRename.sameName'));
              return;
            }
            await doPublish(newName);
          }}
        />

        <MarketSkillSecurityScanModal
          error={securityScanError}
          loading={loading && !securityScanError}
          open={securityScanOpen}
          onClose={() => setSecurityScanOpen(false)}
        />
      </>
    );
  },
);

SkillPublishModal.displayName = 'SkillPublishModal';

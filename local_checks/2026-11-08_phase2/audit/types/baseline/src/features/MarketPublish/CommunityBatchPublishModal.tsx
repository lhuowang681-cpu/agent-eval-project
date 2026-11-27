'use client';

import { Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { App, Checkbox, Modal, Typography } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import CategorySelect from '@/features/MarketPublish/CategorySelect';
import { MarketSkillSecurityScanModal } from '@/features/MarketPublish/MarketSkillSecurityScanModal';
import { isPublishDisplayNameChanged } from '@/features/MarketPublish/publishDisplayName';
import {
  type BatchPublishResourceType,
  type PublishableResourceItem,
  type PublishItemDraft,
} from '@/features/MarketPublish/types';
import { translateSkillImportError } from '@/features/SkillStore/SkillList/skillImportError';
import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import { communityApiService } from '@/services/marketApi';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

export type { BatchPublishResourceType } from '@/features/MarketPublish/types';

interface CommunityBatchPublishModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
  resourceType: BatchPublishResourceType;
}

const toDraft = (item: PublishableResourceItem): PublishItemDraft => ({
  action: item.action,
  category: item.marketCategory ?? undefined,
  displayName: item.name,
  id: item.id,
  installedFromMarket: item.source === 'market-installed',
  marketIdentifier: item.marketIdentifier,
  marketSourceName: item.marketSourceName,
  name: item.name,
  requiresRename: item.requiresRename,
  selected: false,
});

const GO_CREATE_PATH: Record<BatchPublishResourceType, string> = {
  agent: '/',
  mcp: '/settings/skill',
  skill: '/settings/skill',
};

const SKILL_MARKET_PUBLISH_CONCURRENCY = 5;

const runWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item !== undefined) await worker(item, currentIndex);
      }
    }),
  );
};

export const CommunityBatchPublishModal = memo<CommunityBatchPublishModalProps>(
  ({ open, onClose, onSuccess, resourceType }) => {
    const { t } = useTranslation('discover');
    const { t: tSetting } = useTranslation('setting');
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [drafts, setDrafts] = useState<PublishItemDraft[]>([]);
    const [loading, setLoading] = useState(false);
    const [securityScanOpen, setSecurityScanOpen] = useState(false);
    const [securityScanError, setSecurityScanError] = useState<string | null>(null);
    const [securityScanBatchProgress, setSecurityScanBatchProgress] = useState<{
      completed: number;
      runningNames: string[];
      total: number;
    }>();

    useEffect(() => {
      if (!open) return;
      setLoading(true);
      communityApiService
        .getUnpublishedResources()
        .then((result) => {
          const source =
            resourceType === 'agent'
              ? result.agents
              : resourceType === 'skill'
                ? result.skills
                : result.mcps;
          setDrafts(source.map(toDraft));
        })
        .finally(() => setLoading(false));
    }, [open, resourceType]);

    const unpublishedDrafts = useMemo(
      () => drafts.filter((item) => item.action === 'publish'),
      [drafts],
    );
    const delistedDrafts = useMemo(
      () => drafts.filter((item) => item.action === 'relist'),
      [drafts],
    );

    const updateDraft = (id: string, patch: Partial<PublishItemDraft>) => {
      setDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    };

    const selectedDrafts = drafts.filter((item) => item.selected);

    const validateDraft = (draft: PublishItemDraft) => {
      if (!draft.category) {
        message.error(t('upload.batch.categoryRequired', { name: draft.name }));
        return false;
      }

      const displayName = draft.displayName.trim();
      if (!displayName) {
        message.error(t('publish.displayName.required'));
        return false;
      }

      if (
        draft.requiresRename &&
        !isPublishDisplayNameChanged(displayName, draft.marketSourceName || draft.name)
      ) {
        message.error(
          t('publish.displayName.mustDiffer', { name: draft.marketSourceName || draft.name }),
        );
        return false;
      }

      return true;
    };

    const publishDraft = async (draft: PublishItemDraft) => {
      const category = draft.category!;
      const displayName = draft.displayName.trim();
      const useNewName = displayName !== draft.name.trim() ? displayName : undefined;

      if (draft.action === 'relist' && draft.marketIdentifier) {
        const relistOptions = { category, displayName };

        if (resourceType === 'agent') {
          await communityApiService.relistAgentWithSync(draft.marketIdentifier, relistOptions);
          return;
        }

        if (resourceType === 'skill') {
          await communityApiService.relistSkillWithSync(draft.marketIdentifier, relistOptions);
          return;
        }

        await communityApiService.relistMcpWithSync(draft.marketIdentifier, relistOptions);
        return;
      }

      if (resourceType === 'agent') {
        await communityApiService.publishAgent(draft.id, [], [], [], useNewName, category);
        return;
      }

      if (resourceType === 'skill') {
        await communityApiService.publishSkill(draft.id, category, useNewName);
        return;
      }

      const state = useToolStore.getState();
      const manifest = pluginSelectors.getToolManifestById(draft.id)(state);
      const plugin = pluginSelectors.getInstalledPluginById(draft.id)(state);
      await communityApiService.publishMcp(
        draft.id,
        (manifest ?? {}) as unknown as Record<string, unknown>,
        (plugin?.customParams as Record<string, unknown>) ?? {},
        category,
        useNewName,
      );
    };

    const handleBatchPublish = async () => {
      if (selectedDrafts.length === 0) {
        message.error(t('upload.batch.required'));
        return;
      }

      for (const draft of selectedDrafts) {
        if (!validateDraft(draft)) return;
      }

      setLoading(true);
      setSecurityScanError(null);
      setSecurityScanBatchProgress(undefined);
      let hasOpenedSecurityScan = false;
      try {
        for (const draft of selectedDrafts) {
          const conflict =
            resourceType === 'agent'
              ? await communityApiService.checkAgentPublishNameConflict(
                  draft.displayName.trim(),
                  draft.marketIdentifier,
                )
              : resourceType === 'skill'
                ? await communityApiService.checkSkillPublishNameConflict(
                    draft.displayName.trim(),
                    draft.marketIdentifier,
                  )
                : await communityApiService.checkMcpPublishNameConflict(
                    draft.displayName.trim(),
                    draft.marketIdentifier,
                  );

          if (conflict.conflict) {
            message.error(t('upload.batch.nameConflict', { name: draft.displayName.trim() }));
            setLoading(false);
            return;
          }
        }

        if (resourceType === 'skill') {
          hasOpenedSecurityScan = true;
          setSecurityScanOpen(true);
          setSecurityScanBatchProgress({
            completed: 0,
            runningNames: [],
            total: selectedDrafts.length,
          });

          const failures: string[] = [];
          let successCount = 0;

          await runWithConcurrency(
            selectedDrafts,
            SKILL_MARKET_PUBLISH_CONCURRENCY,
            async (draft) => {
              const draftName = draft.displayName.trim() || draft.name;
              setSecurityScanBatchProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      runningNames: [...prev.runningNames, draftName],
                    }
                  : prev,
              );

              try {
                await publishDraft(draft);
                successCount += 1;
              } catch (error) {
                console.error(error);
                failures.push(`${draftName}: ${translateSkillImportError(tSetting, error)}`);
              } finally {
                setSecurityScanBatchProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        completed: prev.completed + 1,
                        runningNames: prev.runningNames.filter((name) => name !== draftName),
                      }
                    : prev,
                );
              }
            },
          );

          await invalidateMarketPublisherState();
          setSecurityScanBatchProgress(undefined);

          if (failures.length > 0) {
            setSecurityScanError(failures.join('\n'));
            if (successCount > 0) await onSuccess?.();
            return;
          }

          setSecurityScanOpen(false);
          message.success(t('upload.batch.success'));
          await onSuccess?.();
          onClose();
          return;
        }

        for (const draft of selectedDrafts) {
          await publishDraft(draft);
        }

        await invalidateMarketPublisherState();
        setSecurityScanOpen(false);
        message.success(t('upload.batch.success'));
        await onSuccess?.();
        onClose();
      } catch (error) {
        console.error(error);
        if (resourceType === 'skill' && hasOpenedSecurityScan) {
          setSecurityScanError(translateSkillImportError(tSetting, error));
        } else {
          message.error(t('upload.batch.failed'));
        }
      } finally {
        setLoading(false);
      }
    };

    const handleGoCreate = () => {
      if (loading) return;
      onClose();
      navigate(GO_CREATE_PATH[resourceType]);
    };

    const renderDraftItem = (draft: PublishItemDraft) => (
      <Flexbox
        gap={10}
        key={`${draft.action}-${draft.id}`}
        padding={12}
        style={{
          background: cssVar.colorFillQuaternary,
          border: `1px solid ${draft.selected ? cssVar.colorPrimaryBorder : cssVar.colorBorderSecondary}`,
          borderRadius: cssVar.borderRadiusLG,
        }}
      >
        <Checkbox
          checked={draft.selected}
          onChange={(event) => updateDraft(draft.id, { selected: event.target.checked })}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            <Text strong>{draft.name}</Text>
            {draft.installedFromMarket && (
              <Tag color={'blue'} size={'small'}>
                {t('publish.source.marketInstalled')}
              </Tag>
            )}
            {draft.action === 'relist' && (
              <Tag color={'default'} size={'small'}>
                {t('tag.delisted')}
              </Tag>
            )}
          </Flexbox>
        </Checkbox>

        {draft.selected && (
          <Flexbox gap={12} style={{ paddingInlineStart: 24 }}>
            <Flexbox gap={4}>
              <Text>{t('publish.displayName.label')}</Text>
              <Input
                value={draft.displayName}
                onChange={(event) => updateDraft(draft.id, { displayName: event.target.value })}
              />
              {draft.requiresRename && (
                <Text type={'secondary'}>
                  {t('publish.displayName.marketHint', {
                    name: draft.marketSourceName || draft.name,
                  })}
                </Text>
              )}
            </Flexbox>
            <Flexbox gap={4}>
              <Text>{t('publish.category.label')}</Text>
              <CategorySelect
                resourceType={resourceType}
                value={draft.category}
                onChange={(value) => updateDraft(draft.id, { category: value })}
              />
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    );

    const renderSection = (title: string, items: PublishItemDraft[]) => {
      if (items.length === 0) return null;

      return (
        <Flexbox gap={8}>
          <Text type={'secondary'}>{title}</Text>
          {items.map(renderDraftItem)}
        </Flexbox>
      );
    };

    return (
      <>
        <Modal
          closable={!loading}
          confirmLoading={loading}
          keyboard={!loading}
          maskClosable={!loading}
          open={open}
          title={t('upload.batch.title')}
          width={640}
          onOk={handleBatchPublish}
          onCancel={() => {
            if (!loading) onClose();
          }}
        >
          <Typography.Paragraph type="secondary">
            {t('upload.batch.description')}
          </Typography.Paragraph>

          <Flexbox gap={16}>
            {renderSection(t('upload.batch.section.unpublished'), unpublishedDrafts)}
            {renderSection(t('upload.batch.section.delisted'), delistedDrafts)}
          </Flexbox>

          {drafts.length === 0 && !loading && (
            <Typography.Text type="secondary">{t('upload.batch.empty')}</Typography.Text>
          )}

          <Flexbox style={{ marginTop: 16 }}>
            <Button disabled={loading} type={'link'} onClick={handleGoCreate}>
              {t('upload.batch.goCreate')}
            </Button>
          </Flexbox>
        </Modal>

        <MarketSkillSecurityScanModal
          batchProgress={securityScanBatchProgress}
          error={securityScanError}
          loading={loading && securityScanOpen && !securityScanError}
          open={securityScanOpen}
          onClose={() => setSecurityScanOpen(false)}
        />
      </>
    );
  },
);

CommunityBatchPublishModal.displayName = 'CommunityBatchPublishModal';

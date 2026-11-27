'use client';

import { Button } from '@lobehub/ui';
import { App, Modal } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import {
  computeMarketInstallButtonState,
  type MarketInstallButtonState,
} from '@/helpers/marketInstallButtonState';
import { communityApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import { useKnowledgeBaseStore } from '@/store/library';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { useDetailContext } from '../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    width: 100%;
  `,
}));

const buildSnapshot = (kb: {
  description?: string | null;
  name: string;
  type?: string | null;
}) => ({
  description: kb.description,
  name: kb.name,
  type: kb.type,
});

const InstallKnowledgeBase = memo(() => {
  const { identifier, name, deletedAt, publisherId, mutate } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const installKnowledgeBase = useDiscoverStore((s) => s.installKnowledgeBase);
  const updateInstalledKnowledgeBase = useDiscoverStore((s) => s.updateInstalledKnowledgeBase);
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const refreshKnowledgeBaseList = useKnowledgeBaseStore((s) => s.refreshKnowledgeBaseList);
  const { data: knowledgeBases = [] } = useFetchKnowledgeBaseList();
  const { message } = App.useApp();
  const { t } = useTranslation('discover');
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const isPublisher = isLogin && currentUserId === publisherId;
  const isDelisted = Boolean(deletedAt);

  const installedKb = useMemo(() => {
    return knowledgeBases.find((kb) => kb.installedFromMarketIdentifier === identifier);
  }, [identifier, knowledgeBases]);

  const buttonState = useMemo(() => {
    if (isPublisher) {
      if (isDelisted) {
        return {
          disabled: false,
          label: t('knowledgeBases.relist'),
          type: 'relist' as const,
        };
      }
      return {
        disabled: false,
        label: t('knowledgeBases.delist'),
        type: 'delist' as const,
      };
    }

    return computeMarketInstallButtonState({
      deletedAt,
      installed: installedKb
        ? {
            currentSnapshot: buildSnapshot(installedKb),
            installedFromSnapshot: installedKb.installedFromSnapshot as Record<
              string,
              unknown
            > | null,
            marketIdentifier: installedKb.marketIdentifier,
          }
        : null,
      labels: {
        delistWarning: t('assistants.delistWarning'),
        install: t('knowledgeBases.installKnowledgeBase'),
        update: t('knowledgeBases.updateInstalled'),
      },
    });
  }, [deletedAt, installedKb, isDelisted, isPublisher, t]);

  const handleAction = async () => {
    if (!identifier || buttonState.disabled) return;

    if (isPublisher) {
      if (buttonState.type === 'delist') {
        Modal.confirm({
          content: t('knowledgeBases.delistConfirm'),
          onOk: async () => {
            setIsLoading(true);
            try {
              await communityApiService.delistKnowledgeBase(identifier);
              message.success(t('knowledgeBases.delistSuccess'));
              await mutate?.();
              await invalidateMarketPublisherState();
            } catch (error) {
              console.error('Delist knowledge base failed:', error);
              message.error(t('knowledgeBases.delistFailed'));
            } finally {
              setIsLoading(false);
            }
          },
          title: name || identifier,
        });
        return;
      }

      if (buttonState.type === 'relist') {
        setIsLoading(true);
        try {
          await communityApiService.relistKnowledgeBaseWithSync(identifier);
          message.success(t('knowledgeBases.relistSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
        } catch (error) {
          console.error('Relist knowledge base failed:', error);
          message.error(t('knowledgeBases.relistFailed'));
        } finally {
          setIsLoading(false);
        }
      }
      return;
    }

    const runInstall = async () => {
      setIsLoading(true);
      try {
        await installKnowledgeBase(identifier);
        await refreshKnowledgeBaseList();
        message.success(t('knowledgeBases.installSuccess'));
      } catch (error) {
        console.error('Install knowledge base failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    const runUpdate = async () => {
      setIsLoading(true);
      try {
        await updateInstalledKnowledgeBase(identifier);
        await refreshKnowledgeBaseList();
        message.success(t('knowledgeBases.updateSuccess'));
      } catch (error) {
        console.error('Update knowledge base failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    if (buttonState.type === 'update') {
      if (buttonState.withWarning) {
        Modal.confirm({
          content: t('knowledgeBases.updateWarning'),
          onOk: runUpdate,
          title: name || identifier,
        });
        return;
      }
      await runUpdate();
      return;
    }

    await runInstall();
  };

  if (!isLogin) {
    return (
      <Button block disabled className={styles.button} size={'large'} type={'primary'}>
        {t('knowledgeBases.installKnowledgeBase')}
      </Button>
    );
  }

  return (
    <Button
      block
      className={styles.button}
      danger={isPublisher && buttonState.type === 'delist'}
      disabled={buttonState.disabled}
      loading={isLoading}
      size={'large'}
      title={(buttonState as MarketInstallButtonState)?.reason}
      type={'primary'}
      onClick={handleAction}
    >
      {buttonState.label}
    </Button>
  );
});

export default InstallKnowledgeBase;

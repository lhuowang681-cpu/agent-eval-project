'use client';

import { Button } from '@lobehub/ui';
import { App, Modal } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_URL } from '@/const/url';
import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import {
  computeMarketInstallButtonState,
  type MarketInstallButtonState,
} from '@/helpers/marketInstallButtonState';
import { communityApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { useDiscoverStore } from '@/store/discover';
import { useHomeStore } from '@/store/home';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  buttonGroup: css`
    width: 100%;
  `,
}));

const InstallAndChat = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { identifier, title, deletedAt, publisherId, mutate } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const installAgent = useDiscoverStore((s) => s.installAgent);
  const updateInstalledAgent = useDiscoverStore((s) => s.updateInstalledAgent);
  const refreshPlugins = useToolStore((s) => s.refreshPlugins);
  const refreshAgentSkills = useToolStore((s) => s.refreshAgentSkills);
  const agentMap = useAgentStore((s) => s.agentMap);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { t } = useTranslation('discover');
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  // Determine if current user is the publisher
  const isPublisher = isLogin && currentUserId === publisherId;

  // Check if the Agent is delisted
  const isDelisted = Boolean(deletedAt);

  const installedAgent = useMemo(() => {
    return Object.values(agentMap).find(
      (agent) => agent.installedFromMarketIdentifier === identifier,
    );
  }, [agentMap, identifier]);

  const buttonState = useMemo(() => {
    // Publisher view: show "下线" or "重新上线" based on delist status
    if (isPublisher) {
      if (isDelisted) {
        return {
          disabled: false,
          label: t('assistants.relist'),
          type: 'relist' as const,
        };
      }
      return {
        disabled: false,
        label: t('assistants.delist'),
        type: 'delist' as const,
      };
    }

    return computeMarketInstallButtonState({
      deletedAt,
      installed: installedAgent
        ? {
            currentSnapshot: {
              description: installedAgent.description,
              systemRole: installedAgent.systemRole,
              title: installedAgent.title,
            },
            installedFromSnapshot: installedAgent.installedFromSnapshot,
            marketIdentifier: installedAgent.marketIdentifier,
          }
        : null,
      labels: {
        delistWarning: t('assistants.delistWarning'),
        install: t('assistants.installAndChat'),
        update: t('assistants.updateInstalled'),
      },
    });
  }, [deletedAt, installedAgent, isDelisted, isPublisher, t]);

  const handleAction = async () => {
    if (buttonState.disabled) return;

    // Publisher actions: delist or relist
    if (isPublisher) {
      if (buttonState.type === 'delist') {
        Modal.confirm({
          content: t('assistants.delistConfirm'),
          onOk: async () => {
            setIsLoading(true);
            try {
              await communityApiService.delistAgent(identifier!);
              message.success(t('assistants.delistSuccess'));
              await mutate?.();
              await invalidateMarketPublisherState();
              await refreshAgentList();
            } catch (error) {
              console.error('Delist Agent failed:', error);
              message.error(t('assistants.delistFailed'));
            } finally {
              setIsLoading(false);
            }
          },
          title,
        });
        return;
      }

      if (buttonState.type === 'relist') {
        setIsLoading(true);
        try {
          await communityApiService.relistAgentWithSync(identifier!);
          message.success(t('assistants.relistSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
          await refreshAgentList();
        } catch (error) {
          console.error('Relist Agent failed:', error);
          message.error(t('assistants.relistFailed'));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      return;
    }

    const runInstall = async () => {
      setIsLoading(true);
      try {
        const result = await installAgent(identifier!);
        await Promise.all([refreshAgentList(), refreshPlugins(), refreshAgentSkills()]);
        message.success(t('assistants.installSuccess'));
        navigate(SESSION_CHAT_URL(result.id, mobile));
      } catch (error) {
        console.error('Install failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    const runUpdate = async () => {
      setIsLoading(true);
      try {
        await updateInstalledAgent(identifier!);
        await refreshAgentList();
        message.success(t('assistants.updateSuccess'));
      } catch (error) {
        console.error('Update failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    if (buttonState.type === 'update') {
      if (buttonState.withWarning) {
        Modal.confirm({
          content: t('assistants.updateWarning'),
          onOk: runUpdate,
          title,
        });
        return;
      }
      await runUpdate();
      return;
    }

    await runInstall();
  };

  // Not logged in — show disabled install button
  if (!isLogin) {
    return (
      <Button block disabled className={styles.buttonGroup} size={'large'} type={'primary'}>
        {t('assistants.installAndChat')}
      </Button>
    );
  }

  return (
    <Button
      block
      className={styles.buttonGroup}
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

export default InstallAndChat;

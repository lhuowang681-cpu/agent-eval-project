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
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { useDetailContext } from '../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    width: 100%;
  `,
}));

const InstallSkill = memo<{ mobile?: boolean }>(() => {
  const { identifier, name, deletedAt, publisherId, mutate } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const installSkill = useDiscoverStore((s) => s.installSkill);
  const updateInstalledSkill = useDiscoverStore((s) => s.updateInstalledSkill);
  const refreshAgentSkills = useToolStore((s) => s.refreshAgentSkills);
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills);
  const { message } = App.useApp();
  const { t } = useTranslation('discover');
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  useFetchAgentSkills(true);

  // Determine if current user is the publisher
  const isPublisher = isLogin && currentUserId === publisherId;

  // Check if the Skill is delisted
  const isDelisted = Boolean(deletedAt);

  const installedSkill = useMemo(() => {
    return agentSkills.find((skill) => skill.installedFromMarketIdentifier === identifier);
  }, [agentSkills, identifier]);

  const localPublishedSkill = useMemo(() => {
    return agentSkills.find((skill) => skill.marketIdentifier === identifier);
  }, [agentSkills, identifier]);

  const buttonState = useMemo(() => {
    // Publisher view: restore the market-linked local copy first if it was deleted.
    if (isPublisher) {
      if (!localPublishedSkill) {
        return {
          disabled: false,
          label: t('skills.restoreToLocal'),
          type: 'restore' as const,
        };
      }
      if (isDelisted) {
        return {
          disabled: false,
          label: t('skills.relist'),
          type: 'relist' as const,
        };
      }
      return {
        disabled: false,
        label: t('skills.delist'),
        type: 'delist' as const,
      };
    }

    return computeMarketInstallButtonState({
      deletedAt,
      installed: installedSkill
        ? {
            currentSnapshot: {
              description: installedSkill.description,
              manifest: installedSkill.manifest,
              name: installedSkill.name,
            },
            installedFromSnapshot: {
              description: installedSkill.installedFromSnapshot?.description,
              manifest: installedSkill.installedFromSnapshot?.manifest,
              name: installedSkill.installedFromSnapshot?.name,
            },
            marketIdentifier: installedSkill.marketIdentifier,
          }
        : null,
      labels: {
        delistWarning: t('assistants.delistWarning'),
        install: t('skills.installSkill'),
        update: t('skills.updateInstalled'),
      },
    });
  }, [deletedAt, installedSkill, isDelisted, isPublisher, localPublishedSkill, t]);

  const handleAction = async () => {
    if (!identifier || buttonState.disabled) return;

    // Publisher actions: delist or relist
    if (isPublisher) {
      if (buttonState.type === 'delist') {
        Modal.confirm({
          content: t('skills.delistConfirm'),
          onOk: async () => {
            setIsLoading(true);
            try {
              await communityApiService.delistSkill(identifier);
              message.success(t('skills.delistSuccess'));
              await mutate?.();
              await invalidateMarketPublisherState();
            } catch (error) {
              console.error('Delist Skill failed:', error);
              message.error(t('skills.delistFailed'));
            } finally {
              setIsLoading(false);
            }
          },
          title: name,
        });
        return;
      }

      if (buttonState.type === 'relist') {
        setIsLoading(true);
        try {
          await communityApiService.relistSkillWithSync(identifier);
          message.success(t('skills.relistSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
        } catch (error) {
          console.error('Relist Skill failed:', error);
          message.error(t('skills.relistFailed'));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (buttonState.type === 'restore') {
        setIsLoading(true);
        try {
          await communityApiService.restoreSkillToLocal(identifier);
          await refreshAgentSkills();
          message.success(t('skills.restoreSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
        } catch (error) {
          console.error('Restore Skill to local failed:', error);
          message.error(t('skills.restoreFailed'));
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
        await installSkill(identifier);
        await refreshAgentSkills();
        message.success(t('skills.installSuccess'));
      } catch (error) {
        console.error('Install skill failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    const runUpdate = async () => {
      setIsLoading(true);
      try {
        await updateInstalledSkill(identifier);
        await refreshAgentSkills();
        message.success(t('skills.updateSuccess'));
      } catch (error) {
        console.error('Update skill failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    if (buttonState.type === 'update') {
      if (buttonState.withWarning) {
        Modal.confirm({
          content: t('skills.updateWarning'),
          onOk: runUpdate,
          title: name,
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
      <Button block disabled className={styles.button} size={'large'} type={'primary'}>
        {t('skills.installSkill')}
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

export default InstallSkill;

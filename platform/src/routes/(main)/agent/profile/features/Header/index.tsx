import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { type ModalInstance } from '@lobehub/ui/base-ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { Modal } from 'antd';
import isEqual from 'fast-deep-equal';
import { BotMessageSquareIcon, MoreHorizontal, Settings2Icon, Share2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { AgentPublishModal } from '@/features/MarketPublish';
import NavHeader from '@/features/NavHeader';
import { ShareResultModal, useShare } from '@/features/PeerShare';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import { useAgentBundledTools } from '@/hooks/useAgentBundledTools';
import { useMarketPublisherState } from '@/hooks/useMarketPublisherState';
import { useShowMarket } from '@/hooks/useShowMarket';
import { communityApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { openAgentSettingsModal } from '../AgentSettings';
import AgentForkTag from './AgentForkTag';
import ForkConfirmModal from './AgentPublishButton/ForkConfirmModal';
import PublishResultModal from './AgentPublishButton/PublishResultModal';
import { type OriginalAgentInfo, useMarketPublish } from './AgentPublishButton/useMarketPublish';
import AgentStatusTag from './AgentStatusTag';
import AgentVersionReviewTag, { useVersionReviewStatus } from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  const { t } = useTranslation(['setting', 'discover', 'share']);
  const td = (key: string) => t(key, { ns: 'discover' });

  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const { mcps, skills, kbs: knowledgeBases } = useAgentBundledTools(activeAgentId);
  const isLogin = useUserStore(authSelectors.isLogin);
  const { isUnderReview } = useVersionReviewStatus();
  const { share, result, resultUrl, closeModal, copyLink, loading: shareLoading } = useShare();

  const publishState = useMarketPublisherState(
    { marketIdentifier: meta?.marketIdentifier },
    'agent',
    Boolean(activeAgentId),
  );

  const settingsModalRef = useRef<ModalInstance | null>(null);
  useEffect(
    () => () => {
      settingsModalRef.current?.close();
      settingsModalRef.current = null;
    },
    [],
  );

  const showMarket = useShowMarket();

  const action = meta?.marketIdentifier ? 'upload' : 'submit';

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();
  const [showForkModal, setShowForkModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [originalAgentInfo, setOriginalAgentInfo] = useState<OriginalAgentInfo | null>(null);

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  const { checkOwnership, completePublish, isPublishing, publish } = useMarketPublish({
    action,
    onSuccess: handlePublishSuccess,
  });

  const doPublish = useCallback(async () => {
    const { needsForkConfirm, originalAgent } = await checkOwnership();
    if (needsForkConfirm && originalAgent) {
      setOriginalAgentInfo(originalAgent);
      setShowForkModal(true);
      return;
    }
    const result = await publish();
    if (result?.needsModal) {
      setShowPublishModal(true);
    }
  }, [checkOwnership, publish]);

  const handleShare = useCallback(() => {
    if (activeAgentId) share('agent', activeAgentId);
  }, [activeAgentId, share]);

  const handlePublishClick = useCallback(async () => {
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue:
            'Your new version is currently under review. Please wait for approval before publishing a new version.',
          ns: 'setting',
        }),
      });
      return;
    }

    if (!meta?.title || meta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName', { ns: 'setting' }) });
      return;
    }

    if (!systemRole || systemRole.trim() === '') {
      message.error({
        content: t('marketPublish.validation.emptySystemRole', { ns: 'setting' }),
      });
      return;
    }

    const runAction = async () => {
      if (!isLogin) {
        message.error({ content: t('marketPublish.validation.needLogin') });
        return;
      }

      if (publishState.action === 'relist' && meta?.marketIdentifier) {
        await communityApiService.relistAgentWithSync(meta.marketIdentifier);
        message.success({ content: td('assistants.relistSuccess') });
        await invalidateMarketPublisherState();
        return;
      }

      await doPublish();
    };

    if (publishState.action === 'publish') {
      Modal.confirm({
        okButtonProps: { type: 'primary' },
        onOk: runAction,
        title: t('marketPublish.validation.confirmPublish'),
      });
      return;
    }

    await runAction();
  }, [
    doPublish,
    isLogin,
    isUnderReview,
    meta?.marketIdentifier,
    meta?.title,
    publishState.action,
    systemRole,
    t,
    td,
  ]);

  const handleForkConfirm = useCallback(async () => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
    const result = await publish();
    if (result?.needsModal) {
      setShowPublishModal(true);
    }
  }, [publish]);

  const menuItems = useMemo(
    () => [
      {
        icon: <Icon icon={Settings2Icon} />,
        key: 'advanced-settings',
        label: t('advancedSettings', { ns: 'setting' }),
        onClick: () => {
          settingsModalRef.current?.close();
          settingsModalRef.current = openAgentSettingsModal();
        },
      },
      ...(showMarket
        ? [
            { type: 'divider' as const },
            {
              icon: <Icon icon={ShapesUploadIcon} />,
              key: 'publish',
              label: td(publishState.labelKey),
              onClick: handlePublishClick,
            },
          ]
        : []),
      {
        disabled: !activeAgentId || shareLoading,
        icon: <Icon icon={Share2} />,
        key: 'share',
        label: t('button.share', { ns: 'share' }),
        onClick: handleShare,
      },
    ],
    [
      activeAgentId,
      handlePublishClick,
      handleShare,
      publishState.labelKey,
      shareLoading,
      showMarket,
      t,
      td,
    ],
  );

  return (
    <>
      <NavHeader
        left={
          <Flexbox horizontal gap={8}>
            <AutoSaveHint />
            <AgentStatusTag />
            <AgentVersionReviewTag />
            <AgentForkTag />
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <DropdownMenu items={menuItems}>
              <ActionIcon
                icon={MoreHorizontal}
                loading={isPublishing}
                size={DESKTOP_HEADER_ICON_SIZE}
              />
            </DropdownMenu>
            <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} />
          </Flexbox>
        }
      />
      <ForkConfirmModal
        loading={isPublishing}
        open={showForkModal}
        originalAgent={originalAgentInfo}
        onConfirm={handleForkConfirm}
        onCancel={() => {
          setShowForkModal(false);
          setOriginalAgentInfo(null);
        }}
      />
      <PublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
      {activeAgentId && meta?.title && (
        <AgentPublishModal
          agentId={activeAgentId}
          agentTitle={meta.title}
          knowledgeBases={knowledgeBases}
          mcps={mcps}
          open={showPublishModal}
          skills={skills}
          onClose={() => setShowPublishModal(false)}
          onSuccess={(identifier) => {
            completePublish(identifier);
            setShowPublishModal(false);
          }}
        />
      )}
      <ShareResultModal
        open={!!result?.open}
        url={resultUrl}
        onClose={closeModal}
        onCopy={copyLink}
      />
    </>
  );
});

export default Header;

import { Button } from '@lobehub/ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import { Popconfirm } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { AgentPublishModal } from '@/features/MarketPublish';
import { useAgentBundledTools } from '@/hooks/useAgentBundledTools';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useVersionReviewStatus } from '../AgentVersionReviewTag';
import ForkConfirmModal from './ForkConfirmModal';
import type { MarketPublishAction } from './types';
import { type OriginalAgentInfo, useMarketPublish } from './useMarketPublish';

interface MarketPublishButtonProps {
  action: MarketPublishAction;
  onPublishSuccess?: (identifier: string) => void;
}

const PublishButton = memo<MarketPublishButtonProps>(({ action, onPublishSuccess }) => {
  const { t } = useTranslation(['setting']);

  const isLogin = useUserStore(authSelectors.isLogin);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { mcps, skills, kbs: knowledgeBases } = useAgentBundledTools(activeAgentId);
  const { checkOwnership, completePublish, isCheckingOwnership, isPublishing, publish } =
    useMarketPublish({
      action,
      onSuccess: onPublishSuccess,
    });

  // Check if latest version is under review
  const { isUnderReview, loading: reviewStatusLoading } = useVersionReviewStatus();

  // Agent data for validation
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);

  // Fork confirmation modal state
  const [showForkModal, setShowForkModal] = useState(false);
  const [originalAgentInfo, setOriginalAgentInfo] = useState<OriginalAgentInfo | null>(null);

  // Publish confirmation popconfirm state
  const [confirmOpened, setConfirmOpened] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const buttonConfig = useMemo(() => {
    if (action === 'upload') {
      return {
        authenticated: t('marketPublish.upload.tooltip'),
        unauthenticated: t('marketPublish.upload.tooltip'),
      } as const;
    }

    const submitText = t('submitAgentModal.tooltips');

    return {
      authenticated: submitText,
      unauthenticated: t('marketPublish.submit.tooltip'),
    } as const;
  }, [action, t]);

  const doPublish = useCallback(async () => {
    // Check ownership before publishing
    const { needsForkConfirm, originalAgent } = await checkOwnership();

    if (needsForkConfirm && originalAgent) {
      // Show fork confirmation modal
      setOriginalAgentInfo(originalAgent);
      setShowForkModal(true);
      return;
    }

    const result = await publish();
    if (result?.needsModal) {
      setShowPublishModal(true);
    }
  }, [checkOwnership, publish]);

  const handleButtonClick = useCallback(() => {
    // Check if version is under review
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue:
            'Your new version is currently under review. Please wait for approval before publishing a new version.',
        }),
      });
      return;
    }

    // Validate name and systemRole
    if (!meta?.title || meta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName') });
      return;
    }

    if (!systemRole || systemRole.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptySystemRole') });
      return;
    }

    // Open popconfirm for user confirmation
    setConfirmOpened(true);
  }, [isUnderReview, meta?.title, systemRole, t]);

  const handleConfirmPublish = useCallback(async () => {
    setConfirmOpened(false);

    if (!isLogin) {
      message.error({ content: t('marketPublish.validation.needLogin') });
      return;
    }

    // User is authenticated via Better Auth, check ownership and publish
    await doPublish();
  }, [doPublish, isLogin, t]);

  const handleForkConfirm = useCallback(async () => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
    const result = await publish();
    if (result?.needsModal) {
      setShowPublishModal(true);
    }
  }, [publish]);

  const handleForkCancel = useCallback(() => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
  }, []);

  const buttonTitle = buttonConfig.authenticated;
  const loading = isCheckingOwnership || isPublishing || reviewStatusLoading;

  return (
    <>
      <Popconfirm
        arrow={false}
        okButtonProps={{ type: 'primary' }}
        open={confirmOpened}
        placement="bottomRight"
        title={t('marketPublish.validation.confirmPublish')}
        onCancel={() => setConfirmOpened(false)}
        onConfirm={handleConfirmPublish}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmOpened(false);
          }
        }}
      >
        <Button
          icon={ShapesUploadIcon}
          loading={loading}
          title={buttonTitle}
          onClick={handleButtonClick}
        >
          {t('publishToCommunity')}
        </Button>
      </Popconfirm>
      <ForkConfirmModal
        loading={isPublishing}
        open={showForkModal}
        originalAgent={originalAgentInfo}
        onCancel={handleForkCancel}
        onConfirm={handleForkConfirm}
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
    </>
  );
});

PublishButton.displayName = 'MarketPublishButton';

export default PublishButton;

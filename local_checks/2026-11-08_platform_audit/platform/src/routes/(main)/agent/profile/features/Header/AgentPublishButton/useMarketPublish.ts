import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { communityApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { type MarketPublishAction } from './types';

export interface OriginalAgentInfo {
  author?: {
    avatar?: string;
    name?: string;
    userName?: string;
  };
  avatar?: string;
  identifier: string;
  name: string;
}

interface UseMarketPublishOptions {
  action: MarketPublishAction;
  onSuccess?: (identifier: string) => void;
}

export interface CheckOwnershipResult {
  needsForkConfirm: boolean;
  originalAgent: OriginalAgentInfo | null;
}

export const useMarketPublish = ({ action, onSuccess }: UseMarketPublishOptions) => {
  const { t } = useTranslation('setting');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCheckingOwnership, setIsCheckingOwnership] = useState(false);
  const isPublishingRef = useRef(false);
  const isLogin = useUserStore(authSelectors.isLogin);
  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const updateAgentMeta = useAgentStore((s) => s.updateAgentMeta);

  const isSubmit = action === 'submit';

  const checkOwnership = useCallback(async (): Promise<CheckOwnershipResult> => {
    return { needsForkConfirm: false, originalAgent: null };
  }, []);

  const publish = useCallback(async () => {
    if (isPublishingRef.current) {
      return { success: false };
    }

    if (!isLogin) {
      return { success: false };
    }

    if (!activeAgentId) {
      return { success: false };
    }

    const messageKey = isSubmit ? 'submit' : 'upload-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submit')
      : t('marketPublish.modal.loading.upload');

    try {
      isPublishingRef.current = true;
      setIsPublishing(true);
      message.loading({ content: loadingMessage, key: messageKey });

      if (meta?.marketIdentifier) {
        await communityApiService.updateAgent(meta.marketIdentifier);
        message.success({
          content: t('assistants.updateSuccess', { ns: 'discover' }),
          key: messageKey,
        });
        onSuccess?.(meta.marketIdentifier);
        return { identifier: meta.marketIdentifier, success: true };
      }

      message.destroy(messageKey);
      return { needsModal: true, success: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('unknownError', { ns: 'common' });
      message.error({
        content: t('marketPublish.modal.messages.publishFailed', {
          message: errorMessage,
        }),
        key: messageKey,
      });
      return { success: false };
    } finally {
      isPublishingRef.current = false;
      setIsPublishing(false);
    }
  }, [activeAgentId, isLogin, isSubmit, meta?.marketIdentifier, onSuccess, t]);

  const completePublish = useCallback(
    (identifier: string) => {
      updateAgentMeta({ marketIdentifier: identifier });
      onSuccess?.(identifier);
      return { identifier, success: true };
    },
    [onSuccess, updateAgentMeta],
  );

  return {
    checkOwnership,
    completePublish,
    isCheckingOwnership,
    isPublishing,
    publish,
  };
};

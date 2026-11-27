'use client';

import { message } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { communityApiService } from '@/services/marketApi';

export type ShareItemType = 'agent' | 'mcp' | 'skill';

export interface ShareResult {
  marketIdentifier: string;
  open: boolean;
  token: string;
}

export const useShare = () => {
  const { t } = useTranslation('share');
  const appOrigin = useAppOrigin();
  const [result, setResult] = useState<ShareResult | null>(null);
  const [loading, setLoading] = useState(false);

  const resultUrl = result ? `${appOrigin}/share/${result.token}` : '';

  const share = useCallback(
    async (itemType: ShareItemType, localId: string) => {
      setLoading(true);
      try {
        const res = await communityApiService.createShare(itemType, localId);
        setResult({ marketIdentifier: res.marketIdentifier, open: true, token: res.token });
      } catch (error) {
        console.error('[useShare] createShare failed:', error);
        const reason = error instanceof Error ? error.message : undefined;
        message.error(
          reason === 'TITLE_AND_SYSTEMROLE_REQUIRED'
            ? t('result.shareRequiresTitleAndPrompt')
            : t('result.shareFailed'),
        );
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const copyLink = useCallback(async () => {
    if (!resultUrl) return;
    await navigator.clipboard.writeText(resultUrl);
  }, [resultUrl]);

  const closeModal = useCallback(() => {
    setResult((prev) => (prev ? { ...prev, open: false } : null));
  }, []);

  return { closeModal, copyLink, loading, result, resultUrl, share };
};

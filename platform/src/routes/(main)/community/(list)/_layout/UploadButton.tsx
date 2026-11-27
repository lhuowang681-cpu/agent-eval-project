'use client';

import { Button } from '@lobehub/ui';
import { Upload } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import { CommunityBatchPublishModal } from '@/features/MarketPublish/CommunityBatchPublishModal';
import { type BatchPublishResourceType } from '@/features/MarketPublish/types';
import { refreshMarketListCache } from '@/store/discover/helpers/refreshMarketList';

const UploadButton = memo(() => {
  const { t } = useTranslation('discover');
  const location = useLocation();
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);

  const resourceType = useMemo<BatchPublishResourceType | null>(() => {
    if (location.pathname.includes('/community/agent')) return 'agent';
    if (location.pathname.includes('/community/skill')) return 'skill';
    if (location.pathname.includes('/community/mcp')) return 'mcp';
    return null;
  }, [location.pathname]);

  if (!resourceType) return null;

  return (
    <>
      <Button icon={Upload} onClick={() => setOpen(true)}>
        {t('upload.button')}
      </Button>
      <CommunityBatchPublishModal
        open={open}
        resourceType={resourceType}
        onClose={() => setOpen(false)}
        onSuccess={() => refreshMarketListCache(resourceType, mutate)}
      />
    </>
  );
});

export default UploadButton;

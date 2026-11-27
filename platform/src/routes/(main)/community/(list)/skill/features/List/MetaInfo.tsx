import { Flexbox, Icon } from '@lobehub/ui';
import { DownloadIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

interface MetaInfoProps {
  className?: string;
  installCount?: number;
  style?: CSSProperties;
  usageCount?: number;
}

const MetaInfo = memo<MetaInfoProps>(({ style, installCount, usageCount, className }) => {
  const { t } = useTranslation('discover');
  const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);

  if (showMarketStats === false) return null;

  return (
    <Flexbox horizontal align={'center'} className={className} gap={8} style={style}>
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={DownloadIcon} size={14} />
        {installCount ?? 0}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={4}>
        {t('assistants.usageCount')} {usageCount ?? 0}
      </Flexbox>
    </Flexbox>
  );
});

export default MetaInfo;

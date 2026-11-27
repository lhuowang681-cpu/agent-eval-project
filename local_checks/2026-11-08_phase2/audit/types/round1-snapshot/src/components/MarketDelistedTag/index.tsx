import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const MarketDelistedTag = memo(() => {
  const { t } = useTranslation('discover');

  return (
    <Tag color="default" size="small">
      {t('tag.delisted')}
    </Tag>
  );
});

MarketDelistedTag.displayName = 'MarketDelistedTag';

export default MarketDelistedTag;

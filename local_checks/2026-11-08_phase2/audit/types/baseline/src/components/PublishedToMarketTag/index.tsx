import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const PublishedToMarketTag = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Tag color="success" size="small">
      {t('tools.publishedToMarket')}
    </Tag>
  );
});

PublishedToMarketTag.displayName = 'PublishedToMarketTag';

export default PublishedToMarketTag;

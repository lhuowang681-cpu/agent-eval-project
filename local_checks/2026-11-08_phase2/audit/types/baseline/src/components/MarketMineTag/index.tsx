import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const MarketMineTag = memo(() => {
  const { t } = useTranslation('discover');

  return (
    <Tag color="gold" size="small">
      {t('tag.mine')}
    </Tag>
  );
});

MarketMineTag.displayName = 'MarketMineTag';

export default MarketMineTag;

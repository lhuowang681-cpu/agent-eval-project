'use client';

import { Flexbox, Input, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CategorySelect, {
  type MarketCategoryResourceType,
} from '@/features/MarketPublish/CategorySelect';

interface MarketPublishFormFieldsProps {
  category?: string;
  displayName?: string;
  marketSourceName?: string | null;
  onCategoryChange: (value: string) => void;
  onDisplayNameChange?: (value: string) => void;
  resourceType: MarketCategoryResourceType;
  showDisplayName?: boolean;
}

const MarketPublishFormFields = memo<MarketPublishFormFieldsProps>(
  ({
    resourceType,
    category,
    onCategoryChange,
    showDisplayName,
    displayName,
    onDisplayNameChange,
    marketSourceName,
  }) => {
    const { t } = useTranslation('discover');

    return (
      <Flexbox gap={12}>
        {showDisplayName && onDisplayNameChange && (
          <Flexbox gap={4}>
            <Text>{t('publish.displayName.label')}</Text>
            <Input
              placeholder={t('publish.displayName.placeholder')}
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
            />
            {marketSourceName && (
              <Text type={'secondary'}>
                {t('publish.displayName.marketHint', { name: marketSourceName })}
              </Text>
            )}
          </Flexbox>
        )}
        <Flexbox gap={4}>
          <Text>{t('publish.category.label')}</Text>
          <CategorySelect
            resourceType={resourceType}
            value={category}
            onChange={onCategoryChange}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

MarketPublishFormFields.displayName = 'MarketPublishFormFields';

export default MarketPublishFormFields;

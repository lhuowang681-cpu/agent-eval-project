'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Tag, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const FeatureFlagsSection = memo(() => {
  const { t } = useTranslation('setting');
  const featureFlags = useServerConfigStore(featureFlagsSelectors);

  const formItems = useMemo<FormGroupItemType[]>(
    () => [
      {
        children: Object.entries(featureFlags).map(([key, value]) => ({
          children: (
            <Tag color={value ? 'success' : 'default'}>
              {value ? t('settingDebug.featureFlags.on') : t('settingDebug.featureFlags.off')}
            </Tag>
          ),
          label: <Text code>{key}</Text>,
          minWidth: undefined,
        })),
        desc: t('settingDebug.featureFlags.desc'),
        title: t('settingDebug.featureFlags.title'),
      },
    ],
    [featureFlags, t],
  );

  return (
    <Form
      collapsible={false}
      items={formItems}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default FeatureFlagsSection;

'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Tag, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const SERVER_CONFIG_BOOLEAN_KEYS = [
  'enableBusinessFeatures',
  'enableAppDevMode',
  'enableKlavis',
  'enableLobehubSkill',
  'enableMagicLink',
  'enableMarketTrustedClient',
  'enableUploadFileToServer',
  'enabledTelemetryChat',
  'enableEmailVerification',
  'disableEmailPassword',
  'disablePublicWebPageCrawl',
] as const;

const ServerConfigSection = memo(() => {
  const { t } = useTranslation('setting');
  const values = useServerConfigStore((s) =>
    SERVER_CONFIG_BOOLEAN_KEYS.map((key) => serverConfigSelectors[key](s)),
  );

  const formItems = useMemo<FormGroupItemType[]>(
    () => [
      {
        children: SERVER_CONFIG_BOOLEAN_KEYS.map((key, index) => ({
          children: (
            <Tag color={values[index] ? 'success' : 'default'}>
              {values[index]
                ? t('settingDebug.featureFlags.on')
                : t('settingDebug.featureFlags.off')}
            </Tag>
          ),
          label: <Text code>{key}</Text>,
          minWidth: undefined,
        })),
        desc: t('settingDebug.serverConfig.desc'),
        title: t('settingDebug.serverConfig.title'),
      },
    ],
    [t, values],
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

export default ServerConfigSection;

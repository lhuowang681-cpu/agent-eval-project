'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Tag } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { CURRENT_VERSION } from '@/const/version';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const EnvironmentSection = memo(() => {
  const { t } = useTranslation('setting');
  const serverVersion = useGlobalStore((s) => s.serverVersion);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  const formItems = useMemo<FormGroupItemType[]>(() => {
    const rows = [
      {
        children: <Tag>{`v${CURRENT_VERSION}`}</Tag>,
        label: t('settingDebug.environment.appVersion'),
        minWidth: undefined,
      },
      serverVersion &&
        serverVersion !== CURRENT_VERSION && {
          children: <Tag>{`v${serverVersion}`}</Tag>,
          label: t('settingDebug.environment.serverVersion'),
          minWidth: undefined,
        },
      {
        children: <Tag>{isDesktop ? 'Desktop' : 'Web'}</Tag>,
        label: t('settingDebug.environment.runtime'),
        minWidth: undefined,
      },
      {
        children: <Tag>{mobile ? 'Mobile' : 'Desktop'}</Tag>,
        label: t('settingDebug.environment.layout'),
        minWidth: undefined,
      },
      {
        children: (
          <Tag color={isDevMode ? 'success' : 'default'}>
            {isDevMode
              ? t('settingDebug.environment.enabled')
              : t('settingDebug.environment.disabled')}
          </Tag>
        ),
        label: t('settingDebug.environment.devMode'),
        minWidth: undefined,
      },
    ].filter(Boolean) as FormGroupItemType['children'];

    return [
      {
        children: rows,
        title: t('settingDebug.environment.title'),
      },
    ];
  }, [isDevMode, mobile, serverVersion, t]);

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

export default EnvironmentSection;

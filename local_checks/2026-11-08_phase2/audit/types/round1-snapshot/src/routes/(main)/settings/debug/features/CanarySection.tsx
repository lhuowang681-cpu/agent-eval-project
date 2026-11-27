'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Select, Switch } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CANARY_IDC_OPTIONS } from '@/const/canary';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const idcSelectOptions = CANARY_IDC_OPTIONS.map((idc) => ({ label: idc, value: idc }));

const CanarySection = memo(() => {
  const { t } = useTranslation('setting');
  const [enableCanary, canaryIdc, setSettings] = useUserStore((s) => [
    userGeneralSettingsSelectors.enableCanary(s),
    userGeneralSettingsSelectors.canaryIdc(s),
    s.setSettings,
  ]);

  const handleEnableChange = useCallback(
    (checked: boolean) => setSettings({ general: { enableCanary: checked } }),
    [setSettings],
  );

  const handleIdcChange = useCallback(
    (value: string) => setSettings({ general: { canaryIdc: value } }),
    [setSettings],
  );

  const formItems = useMemo<FormGroupItemType[]>(
    () => [
      {
        children: [
          {
            children: <Switch checked={enableCanary} onChange={handleEnableChange} />,
            desc: t('settingDebug.canary.enable.desc'),
            label: t('settingDebug.canary.enable.title'),
            minWidth: undefined,
          },
          {
            children: (
              <Select
                disabled={!enableCanary}
                options={idcSelectOptions}
                value={canaryIdc}
                onChange={handleIdcChange}
              />
            ),
            desc: t('settingDebug.canary.idc.desc'),
            label: t('settingDebug.canary.idc.title'),
            minWidth: undefined,
          },
        ],
        title: t('settingDebug.canary.title'),
      },
    ],
    [canaryIdc, enableCanary, handleEnableChange, handleIdcChange, t],
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

export default CanarySection;

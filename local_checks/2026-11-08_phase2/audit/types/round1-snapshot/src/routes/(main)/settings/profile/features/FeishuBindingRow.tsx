'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

interface FeishuBindingRowProps {
  mobile?: boolean;
}

const FeishuBindingRow = ({ mobile }: FeishuBindingRowProps) => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);

  const items = [
    { label: t('profile.feishu.openId'), value: userProfile?.feishuOpenId },
    { label: t('profile.feishu.unionId'), value: userProfile?.feishuUnionId },
  ].filter((item) => !!item.value);

  return (
    <ProfileRow label={t('profile.feishu.title')} mobile={mobile}>
      <Flexbox gap={4} style={{ width: '100%' }}>
        {items.map((item) => (
          <Flexbox horizontal align="center" gap={8} justify="space-between" key={item.label}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {item.label}
            </Text>
            <Typography.Text copyable ellipsis style={{ fontSize: 12 }}>
              {item.value}
            </Typography.Text>
          </Flexbox>
        ))}
      </Flexbox>
    </ProfileRow>
  );
};

export default FeishuBindingRow;

'use client';

import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import CanarySection from './features/CanarySection';
import EnvironmentSection from './features/EnvironmentSection';
import FeatureFlagsSection from './features/FeatureFlagsSection';
import ServerConfigSection from './features/ServerConfigSection';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.debug')} />
      <EnvironmentSection />
      <CanarySection />
      <FeatureFlagsSection />
      <ServerConfigSection />
    </>
  );
};

export default Page;

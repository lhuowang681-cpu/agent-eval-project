'use client';

import { isDesktop } from '@lobechat/const';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import AppEnvironmentSection from './features/AppEnvironmentSection';
import FeishuCliSection from './features/FeishuCliSection';
import GatewayDeviceSection from './features/GatewayDeviceSection';
import OpenCliSection from './features/OpenCliSection';
import ToolDetectorSection from './features/ToolDetectorSection';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.systemTools')} />
      <ToolDetectorSection />
      <AppEnvironmentSection />
      <GatewayDeviceSection />
      <FeishuCliSection />
      {/* OpenCLI bridge IPC is desktop-only; don't render the section on the web SPA */}
      {isDesktop && <OpenCliSection />}
    </>
  );
};

export default Page;

'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { type FC } from 'react';
import { lazy, Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Outlet } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { isDesktop } from '@/const/version';
import { BANNER_HEIGHT } from '@/features/AlertBanner/CloudBanner';
import { useAnnouncementDismissal } from '@/features/AlertBanner/useAnnouncementDismissal';
import DesktopFileMenuBridge from '@/features/DesktopFileMenuBridge';
import DesktopNavigationBridge from '@/features/DesktopNavigationBridge';
import AuthRequiredModal from '@/features/Electron/AuthRequiredModal';
import TitleBar from '@/features/Electron/titlebar/TitleBar';
import HotkeyHelperPanel from '@/features/HotkeyHelperPanel';
import NavPanel from '@/features/NavPanel';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';
import { usePlatform } from '@/hooks/usePlatform';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import CmdkLazy from '@/layout/GlobalProvider/CmdkLazy';
import dynamic from '@/libs/next/dynamic';
import { DndContextWrapper } from '@/routes/(main)/resource/features/DndContextWrapper';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { HotkeyScopeEnum } from '@/types/hotkey';

import DesktopHome from '../home';
import DesktopHomeLayout from '../home/_layout';
import DesktopAutoOidcOnFirstOpen from './DesktopAutoOidcOnFirstOpen';
import DesktopLayoutContainer from './DesktopLayoutContainer';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'));

const AnnouncementBanner = dynamic(() => import('@/features/AlertBanner/AnnouncementBanner'));
const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));

const Layout: FC = () => {
  const { isPWA } = usePlatform();
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const announcement = useServerConfigStore(serverConfigSelectors.announcement);
  const { isDismissed: isAnnouncementClosed, dismiss: dismissAnnouncement } =
    useAnnouncementDismissal(announcement);
  const shouldShowAnnouncement =
    !!announcement?.enabled && !!announcement.message && !isAnnouncementClosed;
  const showTopBanner = shouldShowAnnouncement || showCloudPromotion;
  const mainHeight = isDesktop
    ? `calc(100% - ${TITLE_BAR_HEIGHT}px${showTopBanner ? ` - ${BANNER_HEIGHT}px` : ''})`
    : showTopBanner
      ? `calc(100% - ${BANNER_HEIGHT}px)`
      : '100%';
  const {
    initialValues: feedbackInitialValues,
    isOpen: isFeedbackModalOpen,
    close: closeFeedbackModal,
  } = useFeedbackModal();

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <Suspense fallback={null}>
        {isDesktop && <DesktopAutoOidcOnFirstOpen />}
        {isDesktop && <DesktopNavigationBridge />}
        {isDesktop && <DesktopFileMenuBridge />}
      </Suspense>
      {isDesktop && <AuthRequiredModal />}

      <Suspense fallback={null}>{isDesktop && <TitleBar />}</Suspense>
      <Suspense fallback={null}>
        {shouldShowAnnouncement ? (
          <AnnouncementBanner
            level={announcement.level}
            message={announcement.message}
            title={announcement.title}
            onClose={dismissAnnouncement}
          />
        ) : (
          showCloudPromotion && <CloudBanner />
        )}
      </Suspense>

      <DndContextWrapper>
        <Flexbox
          horizontal
          className={cx(isPWA ? styles.mainContainerPWA : styles.mainContainer)}
          height={mainHeight}
          width={'100%'}
        >
          <NavPanel />
          <DesktopLayoutContainer>
            <MarketAuthProvider isDesktop={isDesktop}>
              <DesktopHomeLayout>
                <DesktopHome />
              </DesktopHomeLayout>
              <Suspense fallback={<Loading debugId="DesktopMainLayout > Outlet" />}>
                <Outlet />
              </Suspense>
            </MarketAuthProvider>
          </DesktopLayoutContainer>
        </Flexbox>
      </DndContextWrapper>
      <Suspense fallback={null}>
        <HotkeyHelperPanel />
        <RegisterHotkeys />
        <CmdkLazy />
        {isFeedbackModalOpen && (
          <Suspense fallback={null}>
            <FeedbackModal
              initialValues={feedbackInitialValues}
              open={isFeedbackModalOpen}
              onClose={closeFeedbackModal}
            />
          </Suspense>
        )}
      </Suspense>
    </HotkeysProvider>
  );
};

export default Layout;

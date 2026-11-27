'use client';

import { type FC } from 'react';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { useAnnouncementDismissal } from '@/features/AlertBanner/useAnnouncementDismissal';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import dynamic from '@/libs/next/dynamic';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { NavigatorRegistrar } from '@/utils/router';

import NavBar from './NavBar';

const AnnouncementBanner = dynamic(() => import('@/features/AlertBanner/AnnouncementBanner'));
const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
const MOBILE_NAV_ROUTES = new Set([
  '/',
  '/community',
  '/community/agent',
  '/community/mcp',
  '/community/plugin',
  '/community/model',
  '/community/provider',
  '/me',
]);

const MobileMainLayout: FC = () => {
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const announcement = useServerConfigStore(serverConfigSelectors.announcement);
  const { isDismissed: isAnnouncementClosed, dismiss: dismissAnnouncement } =
    useAnnouncementDismissal(announcement);
  const shouldShowAnnouncement =
    !!announcement?.enabled && !!announcement.message && !isAnnouncementClosed;
  const location = useLocation();
  const pathname = location.pathname;
  const showNav = MOBILE_NAV_ROUTES.has(pathname);
  return (
    <>
      <NavigatorRegistrar />
      <Suspense fallback={null}>
        {shouldShowAnnouncement ? (
          <AnnouncementBanner
            mobile
            level={announcement.level}
            message={announcement.message}
            title={announcement.title}
            onClose={dismissAnnouncement}
          />
        ) : (
          showCloudPromotion && <CloudBanner mobile />
        )}
      </Suspense>
      <MarketAuthProvider isDesktop={false}>
        <Suspense fallback={<Loading debugId="MobileMainLayout > Outlet" />}>
          <Outlet />
          {showNav && <NavBar />}
        </Suspense>
      </MarketAuthProvider>
    </>
  );
};

export default MobileMainLayout;

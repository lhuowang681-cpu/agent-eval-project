'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import NavHeader from '@/features/NavHeader';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';

import MyPublishedFilter from '../features/MyPublishedFilter';
import SortButton from '../features/SortButton';
import { styles } from './Header/style';
import UploadButton from './UploadButton';

const Header = memo(() => {
  const location = useLocation();
  const isHome =
    location.pathname === '/community' ||
    location.pathname === '/community/' ||
    location.pathname.endsWith('/community');

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={styles.headerContainer}
      left={<StoreSearchBar />}
      style={cssVariables}
      right={
        !isHome && (
          <>
            <UploadButton />
            <MyPublishedFilter />
            <SortButton />
            <UserAvatar />
          </>
        )
      }
      styles={{
        left: { flex: 1 },
      }}
    />
  );
});

export default Header;

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import McpAdaTokenCommunityPrompt from '@/features/McpAdaTokenConfig/CommunityPrompt';

import Sidebar from './Sidebar';
import { styles } from './style';

const Layout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      <McpAdaTokenCommunityPrompt />
      {/* ↓ cloud slot ↓ */}

      {/* ↑ cloud slot ↑ */}
    </>
  );
};

export default Layout;

'use client';

import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import Deployment from '@/features/MCPPluginDetail/Deployment';
import Nav from '@/features/MCPPluginDetail/Nav';
import Overview from '@/features/MCPPluginDetail/Overview';
import Schema from '@/features/MCPPluginDetail/Schema';
import { useQueryState } from '@/hooks/useQueryParam';
import { McpNavKey } from '@/types/discover';

import Sidebar from '../Sidebar';

interface DetailsProps {
  mobile?: boolean;
}

const Details = memo<DetailsProps>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTab, setActiveTab] = useQueryState('activeTab', {
    clearOnDefault: true,
    defaultValue: McpNavKey.Overview,
  });

  return (
    <Flexbox gap={24}>
      <Nav
        hideAgentsTab
        noSettings
        activeTab={activeTab as McpNavKey}
        mobile={mobile}
        setActiveTab={setActiveTab}
      />
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          flex={1}
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          {activeTab === McpNavKey.Overview && <Overview />}
          {activeTab === McpNavKey.Deployment && <Deployment mobile={mobile} />}
          {activeTab === McpNavKey.Schema && <Schema />}
        </Flexbox>
        <Sidebar mobile={mobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;

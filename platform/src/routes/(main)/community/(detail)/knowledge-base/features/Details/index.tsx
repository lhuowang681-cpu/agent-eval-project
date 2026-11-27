'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Sidebar from '../Sidebar';
import Overview from './Overview';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  return (
    <Flexbox gap={24}>
      <Flexbox
        gap={48}
        horizontal={!isMobile}
        style={isMobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox flex={1} style={{ minWidth: 0 }} width={'100%'}>
          <Overview />
        </Flexbox>
        <Sidebar mobile={isMobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;

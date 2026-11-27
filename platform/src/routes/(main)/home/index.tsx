import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import PageTitle from '@/components/PageTitle';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';

import HomeContent from './features';
import QuickLinks from './_layout/Header/components/QuickLinks';

const Home: FC = () => {
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';

  return (
    <>
      {isHomeRoute && <PageTitle title="" />}
      <NavHeader right={<QuickLinks />} />
      <Flexbox height={'100%'} style={{ overflowY: 'auto', paddingBottom: '16vh' }} width={'100%'}>
        <WideScreenContainer>
          <HomeContent />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Home;

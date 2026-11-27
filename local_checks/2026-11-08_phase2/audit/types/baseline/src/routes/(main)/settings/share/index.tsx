import { useTranslation } from 'react-i18next';

import { MySharesList } from '@/features/PeerShare';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('share');
  return (
    <>
      <SettingHeader title={t('myShares.title')} />
      <MySharesList />
    </>
  );
};

export default Page;

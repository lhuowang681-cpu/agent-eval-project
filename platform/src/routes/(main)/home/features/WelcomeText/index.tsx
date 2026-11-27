import { Center } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const WelcomeText = memo(() => {
  const { t } = useTranslation('welcome');

  const sentence = useMemo(() => {
    const messages = t('welcomeMessages', { returnObjects: true }) as Record<string, string>;
    // return sample(Object.values(messages));
    return '致力于打造你的程里助手';
  }, [t]);

  return (
    <Center
      style={{
        fontSize: 28,
        fontWeight: 'bold',
        marginBlock: '36px 24px',
      }}
    >
      {sentence}
    </Center>
  );
});

export default WelcomeText;

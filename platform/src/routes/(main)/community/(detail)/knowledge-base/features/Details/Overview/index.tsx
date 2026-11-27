'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '../../../../../components/Title';
import { useDetailContext } from '../../DetailProvider';

const Overview = memo(() => {
  const { t } = useTranslation('discover');
  const { description } = useDetailContext();

  return (
    <Flexbox gap={24}>
      <Flexbox gap={16}>
        <Title>{t('knowledgeBases.details.summary.title')}</Title>
        <Markdown variant={'chat'}>{description || t('knowledgeBases.emptyDescription')}</Markdown>
      </Flexbox>
    </Flexbox>
  );
});

export default Overview;

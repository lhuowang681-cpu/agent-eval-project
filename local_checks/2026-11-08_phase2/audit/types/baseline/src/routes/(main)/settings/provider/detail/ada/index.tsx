'use client';

import { Alert } from '@lobehub/ui';
import { AdaProviderCard } from 'model-bank/modelProviders';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import ProviderDetail from '../default';
import CheckError from './CheckError';

const ADA_CODING_PLAN_URL = 'https://aicoding.portal.ctripcorp.com/codingPlan';

const CodingPlanAlert = memo(() => {
  const { t } = useTranslation('modelProvider');
  const { data } = lambdaQuery.aiProvider.checkAdaCodingPlan.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!data || data.activated) return null;

  return (
    <Alert
      showIcon
      type={'warning'}
      title={
        <>
          {t('ada.noCodingPlan.desc')}{' '}
          <a href={ADA_CODING_PLAN_URL} rel="noreferrer" target="_blank">
            {t('ada.noCodingPlan.action')}
          </a>
        </>
      }
    />
  );
});

const Page = memo(() => {
  return (
    <>
      <CodingPlanAlert />
      <ProviderDetail {...AdaProviderCard} checkErrorRender={CheckError} />
    </>
  );
});

export default Page;

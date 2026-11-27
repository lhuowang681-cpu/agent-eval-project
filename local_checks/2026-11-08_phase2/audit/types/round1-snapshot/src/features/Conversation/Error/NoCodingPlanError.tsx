import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';

const ADA_CODING_PLAN_URL = 'https://aicoding.portal.ctripcorp.com/codingPlan';

interface NoCodingPlanErrorProps {
  id: string;
}

const NoCodingPlanErrorView = memo<NoCodingPlanErrorProps>(({ id }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const [deleteMessage] = useConversationStore((s) => [s.deleteMessage]);

  return (
    <BaseErrorForm
      avatar={<ProviderIcon provider={'ada'} shape={'square'} size={40} />}
      desc={t('ada.noCodingPlan.desc', { ns: 'modelProvider' })}
      title={t('ada.noCodingPlan.title', { ns: 'modelProvider' })}
      action={
        <Button
          type={'primary'}
          onClick={() => {
            window.open(ADA_CODING_PLAN_URL, '_blank', 'noreferrer');
            deleteMessage(id);
          }}
        >
          {t('ada.noCodingPlan.action', { ns: 'modelProvider' })}
        </Button>
      }
    />
  );
});

export default NoCodingPlanErrorView;

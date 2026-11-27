import { type ChatMessageError } from '@lobechat/types';
import { Alert, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Container from '../ollama/Container';

const ADA_CODING_PLAN_URL = 'https://aicoding.portal.ctripcorp.com/codingPlan';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-weight: 500;
    color: ${cssVar.colorLink};

    &:hover {
      color: ${cssVar.colorLinkHover};
    }
  `,
}));

const CheckError = ({
  defaultError,
  error,
  setError,
}: {
  defaultError: ReactNode;
  error?: ChatMessageError;
  setError: (error?: ChatMessageError) => void;
}) => {
  const { t } = useTranslation('modelProvider');

  if (error?.type === 'NoCodingPlanError') {
    return (
      <Container setError={setError}>
        <Alert
          showIcon
          title={t('ada.noCodingPlan.title')}
          type={'warning'}
          extra={
            <Flexbox paddingBlock={8} paddingInline={16}>
              <Trans
                i18nKey="ada.noCodingPlan.desc"
                ns="modelProvider"
                components={[
                  <a
                    className={styles.link}
                    href={ADA_CODING_PLAN_URL}
                    key="ada-activate-link"
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLinkIcon size={14} />
                  </a>,
                ]}
              />
            </Flexbox>
          }
        />
      </Container>
    );
  }

  return defaultError;
};

export default CheckError;

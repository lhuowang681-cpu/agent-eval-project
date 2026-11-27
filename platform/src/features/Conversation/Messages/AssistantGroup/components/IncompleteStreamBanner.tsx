import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { StepForward } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    align-items: center;
    justify-content: space-between;

    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface IncompleteStreamBannerProps {
  assistantId: string;
  blockId: string;
  isIncomplete?: boolean;
}

const IncompleteStreamBanner = memo<IncompleteStreamBannerProps>(
  ({ assistantId, blockId, isIncomplete }) => {
    const { t } = useTranslation('chat');
    const [continueGenerationMessage, isContinuing, isGenerating] = useConversationStore((s) => [
      s.continueGenerationMessage,
      messageStateSelectors.isMessageContinuing(blockId)(s),
      messageStateSelectors.isMessageGenerating(blockId)(s),
    ]);

    const shouldHideBanner = !isIncomplete || isContinuing || isGenerating;

    if (shouldHideBanner) return null;

    return (
      <Flexbox
        horizontal
        className={styles.container}
        data-testid="incomplete-stream-banner"
        gap={12}
        width="100%"
      >
        <Text
          data-testid="incomplete-stream-alert"
          style={{ flex: 1, fontSize: 13 }}
          type="secondary"
        >
          {t('messageAction.streamIncompleteBanner')}
        </Text>
        <Button
          data-testid="incomplete-stream-continue"
          icon={StepForward}
          loading={isContinuing}
          size="small"
          type="primary"
          onClick={() => continueGenerationMessage(assistantId, blockId)}
        >
          {t('messageAction.continueGeneration')}
        </Button>
      </Flexbox>
    );
  },
);

IncompleteStreamBanner.displayName = 'IncompleteStreamBanner';

export default IncompleteStreamBanner;

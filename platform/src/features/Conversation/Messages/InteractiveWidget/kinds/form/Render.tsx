'use client';

import type {
  FormWidgetDefinition,
  InteractiveWidgetSubmission,
  MessageMetadata,
} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';

import FormRenderer from '@/features/Conversation/Messages/Form/FormRenderer';
import { buildFormSubmissionSummary } from '@/features/Conversation/Messages/Form/schema';
import { useConversationStore } from '@/features/Conversation/store';

import type { InteractiveWidgetRenderProps } from '../../registry';

const useStyles = createStyles(({ css, token }) => ({
  summary: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
}));

const createSubmission = (
  definition: FormWidgetDefinition,
  values: Record<string, unknown>,
): InteractiveWidgetSubmission => ({
  kind: 'form',
  submittedAt: new Date().toISOString(),
  summary: buildFormSubmissionSummary(definition, values),
  values,
  widgetId: definition.id,
});

const FormWidget = memo<InteractiveWidgetRenderProps<FormWidgetDefinition>>(
  ({ definition, messageId, submission }) => {
    const { styles } = useStyles();
    const [submitting, setSubmitting] = useState(false);
    const [localSubmission, setLocalSubmission] = useState<
      InteractiveWidgetSubmission | undefined
    >();
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const updateMessageMetadata = useConversationStore((s) => s.updateMessageMetadata);

    const currentSubmission = submission || localSubmission;

    const handleSubmit = useCallback(
      async (values: Record<string, unknown>) => {
        if (submitting) return;

        const nextSubmission = createSubmission(definition, values);
        setSubmitting(true);

        try {
          setLocalSubmission(nextSubmission);
          await updateMessageMetadata(messageId, {
            interactiveWidgetSubmission: nextSubmission,
          } satisfies Partial<MessageMetadata>);

          if (definition.behavior?.submitMode !== 'save-only') {
            await sendMessage({
              message: nextSubmission.summary,
              metadata: {
                interactiveWidgetSubmission: nextSubmission,
              },
            });
          }
        } finally {
          setSubmitting(false);
        }
      },
      [definition, messageId, sendMessage, submitting, updateMessageMetadata],
    );

    if (currentSubmission && !definition.behavior?.allowEditAfterSubmit) {
      return (
        <Flexbox className={styles.summary} gap={4}>
          {currentSubmission.summary}
        </Flexbox>
      );
    }

    return (
      <FormRenderer
        definition={definition}
        disabled={!!currentSubmission && !definition.behavior?.allowEditAfterSubmit}
        loading={submitting}
        onSubmit={handleSubmit}
      />
    );
  },
);

FormWidget.displayName = 'FormWidget';

export default FormWidget;

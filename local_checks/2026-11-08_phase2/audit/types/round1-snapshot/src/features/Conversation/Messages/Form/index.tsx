'use client';

import type {
  InteractiveFormDefinition,
  InteractiveFormSubmission,
  MessageMetadata,
} from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';

import { useConversationStore } from '../../store';
import FormRenderer from './FormRenderer';
import InvalidFormNotice from './InvalidFormNotice';
import { buildFormSubmissionSummary, normalizeInteractiveFormDefinition } from './schema';

const useStyles = createStyles(({ css, token }) => ({
  invalid: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorErrorBorder};
    border-radius: ${token.borderRadiusLG}px;

    color: ${token.colorErrorText};

    background: ${token.colorErrorBg};
  `,
  loading: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  summary: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
}));

interface FormMessageProps {
  definition: unknown;
  isGenerating?: boolean;
  messageId: string;
  submitted?: InteractiveFormSubmission;
}

const createSubmission = (
  definition: InteractiveFormDefinition,
  values: Record<string, unknown>,
): InteractiveFormSubmission => ({
  formId: definition.id,
  submittedAt: new Date().toISOString(),
  summary: buildFormSubmissionSummary(definition, values),
  values,
});
const FormMessage = memo<FormMessageProps>(({ definition, isGenerating, messageId, submitted }) => {
  const { styles } = useStyles();
  const [submitting, setSubmitting] = useState(false);
  const [localSubmission, setLocalSubmission] = useState<InteractiveFormSubmission | undefined>();
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const updateMessageMetadata = useConversationStore((s) => s.updateMessageMetadata);

  const formDefinition = useMemo(
    () => normalizeInteractiveFormDefinition(definition),
    [definition],
  );
  const submission = submitted || localSubmission;

  const handleSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      if (!formDefinition || submitting) return;

      const nextSubmission = createSubmission(formDefinition, values);
      setSubmitting(true);

      try {
        setLocalSubmission(nextSubmission);
        await updateMessageMetadata(messageId, {
          interactiveFormSubmission: nextSubmission,
        } satisfies Partial<MessageMetadata>);

        if (formDefinition.behavior?.submitMode !== 'save-only') {
          await sendMessage({
            message: nextSubmission.summary,
            metadata: {
              interactiveFormSubmission: nextSubmission,
            },
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [formDefinition, messageId, sendMessage, submitting, updateMessageMetadata],
  );

  if (!formDefinition) {
    if (isGenerating) {
      return (
        <Flexbox className={styles.loading} gap={12}>
          <Skeleton.Title active fontSize={18} lineHeight={1.4} width={'42%'} />
          <Skeleton.Paragraph active rows={4} style={{ marginBottom: 0 }} />
          <Skeleton.Button active block style={{ height: 36 }} />
        </Flexbox>
      );
    }

    return (
      <InvalidFormNotice className={styles.invalid} definition={definition} messageId={messageId} />
    );
  }

  if (submission && !formDefinition.behavior?.allowEditAfterSubmit) {
    return (
      <Flexbox className={styles.summary} gap={4}>
        {submission.summary}
      </Flexbox>
    );
  }

  return (
    <FormRenderer
      definition={formDefinition}
      disabled={!!submission && !formDefinition.behavior?.allowEditAfterSubmit}
      loading={submitting}
      onSubmit={handleSubmit}
    />
  );
});

FormMessage.displayName = 'FormMessage';

export default FormMessage;

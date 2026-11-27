import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import InvalidWidgetNotice from '@/features/Conversation/Messages/InteractiveWidget/InvalidWidgetNotice';
import { getInteractiveWidgetKind } from '@/features/Conversation/Messages/InteractiveWidget/registry';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';

import type { MarkdownElementProps } from '../type';

interface InteractiveWidgetNodeProps {
  definition?: string;
}

const Render = memo<MarkdownElementProps<InteractiveWidgetNodeProps>>(({ id, node }) => {
  const isGenerating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const submission = useConversationStore(
    (s) => dataSelectors.getDisplayMessageById(id)(s)?.metadata?.interactiveWidgetSubmission,
  );

  const raw = node.properties.definition;

  const parsed = useMemo(() => {
    if (!raw) return undefined;

    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }, [raw]);

  const kindDefinition =
    parsed && typeof parsed === 'object'
      ? getInteractiveWidgetKind((parsed as Record<string, unknown>).kind)
      : undefined;
  const normalized = kindDefinition?.normalize(parsed);

  if (!normalized || !kindDefinition) {
    if (isGenerating) {
      return (
        <Flexbox gap={12} padding={16}>
          <Skeleton.Title active fontSize={18} lineHeight={1.4} width={'42%'} />
          <Skeleton.Paragraph active rows={4} style={{ marginBottom: 0 }} />
        </Flexbox>
      );
    }

    return <InvalidWidgetNotice definition={parsed} messageId={id} />;
  }

  const { Component } = kindDefinition;

  return <Component definition={normalized} messageId={id} submission={submission} />;
});

Render.displayName = 'InteractiveWidgetRender';

export default Render;

import { memo, useMemo } from 'react';

import FormMessage from '@/features/Conversation/Messages/Form';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';

import type { MarkdownElementProps } from '../type';

interface InteractiveFormNodeProps {
  definition?: string;
}

const Render = memo<MarkdownElementProps<InteractiveFormNodeProps>>(({ id, node }) => {
  const submitted = useConversationStore(
    (s) => dataSelectors.getDisplayMessageById(id)(s)?.metadata?.interactiveFormSubmission,
  );
  const isGenerating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const definition = useMemo(() => {
    const raw = node.properties.definition;

    if (!raw) return undefined;

    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }, [node.properties.definition]);

  return (
    <FormMessage
      definition={definition}
      isGenerating={isGenerating}
      messageId={id}
      submitted={submitted}
    />
  );
});

Render.displayName = 'InteractiveFormRender';

export default Render;

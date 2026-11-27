import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { useErrorContent } from '@/features/Conversation/Error';
import { type AssistantContentBlock } from '@/types/index';

import ErrorContent from '../../../ChatItem/components/ErrorContent';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import MessageContent from '../../AssistantGroup/components/MessageContent';
import { Tools } from '../../AssistantGroup/Tools';
import Reasoning from '../../components/Reasoning';

interface ContentBlockProps extends AssistantContentBlock {
  disableEditing?: boolean;
  parentMessageId?: string;
}

const ContentBlock = memo<ContentBlockProps>(
  ({ id, tools, content, reasoning, error, disableEditing, parentMessageId }) => {
    const parentMessage = useConversationStore(
      (s) =>
        parentMessageId ? dataSelectors.getDisplayMessageById(parentMessageId)(s) : undefined,
      isEqual,
    );
    const errorContent = useErrorContent(error, {
      model: parentMessage?.model ?? undefined,
      provider: parentMessage?.provider ?? undefined,
    });
    const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));
    const hasTools = tools && tools.length > 0;
    const showReasoning =
      (!!reasoning && reasoning.content?.trim() !== '') || (!reasoning && isReasoning);

    if (error && (content === LOADING_FLAT || !content))
      return <ErrorContent error={errorContent} id={id} />;

    return (
      <Flexbox gap={8} id={id}>
        {showReasoning && <Reasoning {...reasoning} id={id} />}

        {/* Content - markdown text */}
        <MessageContent contentOverride={content} hasToolsOverride={hasTools} id={id} />

        {/* Tools */}
        {hasTools && <Tools disableEditing={disableEditing} messageId={id} />}
      </Flexbox>
    );
  },
);

export default ContentBlock;

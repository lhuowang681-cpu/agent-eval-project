import { Flexbox, Highlighter } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { useErrorContent } from '@/features/Conversation/Error';

import ErrorContent from '../../../ChatItem/components/ErrorContent';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import ImageFileListViewer from '../../components/ImageFileListViewer';
import Reasoning from '../../components/Reasoning';
import { Tools } from '../Tools';
import MessageContent from './MessageContent';
import type { RenderableAssistantContentBlock } from './types';

interface ContentBlockProps extends RenderableAssistantContentBlock {
  assistantId: string;
  disableEditing?: boolean;
}
const ContentBlock = memo<ContentBlockProps>(
  ({
    id,
    tools,
    content,
    imageList,
    reasoning,
    error,
    assistantId,
    disableEditing,
    domId,
    contentOverride,
    hasToolsOverride,
  }) => {
    const parentMessage = useConversationStore(
      (s) => dataSelectors.getDisplayMessageById(assistantId)(s),
      isEqual,
    );
    const errorContent = useErrorContent(error, {
      model: parentMessage?.model ?? undefined,
      provider: parentMessage?.provider ?? undefined,
    });
    const showImageItems = !!imageList && imageList.length > 0;
    const [isReasoning, deleteMessage, continueGeneration] = useConversationStore((s) => [
      messageStateSelectors.isMessageInReasoning(id)(s),
      s.deleteDBMessage,
      s.continueGeneration,
    ]);
    const displayContent = contentOverride ?? content;
    const hasTools = hasToolsOverride ?? (tools && tools.length > 0);
    const showReasoning = (!!reasoning && reasoning.content?.trim() !== '') || isReasoning;

    const handleRegenerate = useCallback(async () => {
      await deleteMessage(id);
      continueGeneration(assistantId);
    }, [assistantId, continueGeneration, deleteMessage, id]);

    if (error && (displayContent === LOADING_FLAT || !displayContent)) {
      return (
        <ErrorContent
          id={id}
          error={
            errorContent && error && (displayContent === LOADING_FLAT || !displayContent)
              ? {
                  ...errorContent,
                  extra: error?.body && (
                    <Highlighter
                      actionIconSize={'small'}
                      language={'json'}
                      padding={8}
                      variant={'borderless'}
                    >
                      {JSON.stringify(error?.body, null, 2)}
                    </Highlighter>
                  ),
                }
              : undefined
          }
          onRegenerate={handleRegenerate}
        />
      );
    }

    return (
      <Flexbox gap={8} id={domId ?? id}>
        {showReasoning && <Reasoning {...reasoning} id={id} />}

        {/* Content - markdown text */}
        <MessageContent contentOverride={contentOverride} hasToolsOverride={hasTools} id={id} />

        {/* Image files */}
        {showImageItems && <ImageFileListViewer items={imageList} />}

        {/* Tools */}
        {hasTools && <Tools disableEditing={disableEditing} messageId={id} />}
      </Flexbox>
    );
  },
);

export default ContentBlock;

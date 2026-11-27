import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { dataSelectors, useConversationStore } from '../../store';
import Tool from './Tool';
import { shouldRenderToolCall } from './toolRenderRules';

interface ToolsRendererProps {
  disableEditing?: boolean;
  messageId: string;
}

export const Tools = memo<ToolsRendererProps>(({ disableEditing, messageId }) => {
  const visibleToolCallIds = useConversationStore((s) => {
    const tools = dataSelectors.getToolsInBlock(messageId)(s);
    if (!tools || tools.length === 0) return [];
    return tools.filter(shouldRenderToolCall).map((tool) => tool.id);
  }, isEqual);

  if (visibleToolCallIds.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {visibleToolCallIds.map((toolCallId) => (
        <Tool
          assistantMessageId={messageId}
          disableEditing={disableEditing}
          id={toolCallId}
          key={toolCallId}
        />
      ))}
    </Flexbox>
  );
});

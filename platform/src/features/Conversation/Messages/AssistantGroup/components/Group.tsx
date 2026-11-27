import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { CollapsedMessage } from './CollapsedMessage';
import GroupItem from './GroupItem';
import type { RenderableAssistantContentBlock } from './types';
import WorkflowCollapse, { type WorkflowExpandLevelDefault } from './WorkflowCollapse';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      &:has(.tool-blocks) {
        width: 100%;
      }
    `,
  };
});

interface GroupChildrenProps {
  blocks: AssistantContentBlock[];
  content?: string;
  contentId?: string;
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  id: string;
  messageIndex: number;
}

interface AnswerSegment {
  block: RenderableAssistantContentBlock;
  kind: 'answer';
}

interface WorkflowSegment {
  blocks: RenderableAssistantContentBlock[];
  kind: 'workflow';
}

type GroupRenderSegment = AnswerSegment | WorkflowSegment;

const isEmptyBlock = (block: RenderableAssistantContentBlock) =>
  (!block.content || block.content === LOADING_FLAT) &&
  (!block.tools || block.tools.length === 0) &&
  !block.error &&
  !block.reasoning;

const hasTools = (block: AssistantContentBlock): boolean => !!block.tools?.length;

const appendWorkflowBlock = (
  segments: GroupRenderSegment[],
  block: RenderableAssistantContentBlock,
) => {
  const lastSegment = segments.at(-1);
  if (lastSegment?.kind === 'workflow') {
    lastSegment.blocks.push(block);
    return;
  }

  segments.push({ blocks: [block], kind: 'workflow' });
};

const partitionBlocks = (blocks: AssistantContentBlock[]): GroupRenderSegment[] => {
  const segments: GroupRenderSegment[] = [];

  for (const block of blocks) {
    if (hasTools(block)) {
      appendWorkflowBlock(segments, block);
      continue;
    }

    segments.push({ block, kind: 'answer' });
  }

  return segments;
};

const Group = memo<GroupChildrenProps>(
  ({
    blocks,
    contentId,
    defaultWorkflowExpandLevel,
    disableEditing,
    messageIndex,
    id,
    content,
  }) => {
    const isCollapsed = useConversationStore(messageStateSelectors.isMessageCollapsed(id));
    const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);
    const segments = useMemo(() => partitionBlocks(blocks), [blocks]);

    if (isCollapsed) {
      return (
        content && (
          <Flexbox>
            <CollapsedMessage content={content} id={id} />
          </Flexbox>
        )
      );
    }

    return (
      <MessageAggregationContext value={contextValue}>
        <Flexbox className={styles.container} gap={8}>
          {segments.map((segment, index) => {
            if (segment.kind === 'workflow') {
              if (segment.blocks.length === 0) return null;

              return (
                <WorkflowCollapse
                  assistantMessageId={id}
                  blocks={segment.blocks}
                  defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
                  disableEditing={disableEditing}
                  key={segment.blocks[0]?.renderKey ?? `${id}.workflow.${index}`}
                />
              );
            }

            const item = segment.block;
            if (isEmptyBlock(item)) return null;

            return (
              <GroupItem
                {...item}
                assistantId={id}
                contentId={contentId}
                disableEditing={disableEditing}
                key={item.renderKey ?? `${id}.${item.id}.${index}`}
                messageIndex={messageIndex}
              />
            );
          })}
        </Flexbox>
      </MessageAggregationContext>
    );
  },
  isEqual,
);

export default Group;

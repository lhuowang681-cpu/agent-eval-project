import type { ChatToolPayloadWithResult } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, LoaderCircle, Unplug, X } from 'lucide-react';
import { type Key, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

import {
  areWorkflowToolsComplete,
  getWorkflowSummaryText,
  hasPendingIntervention,
  hasWorkflowError,
} from '../toolDisplayNames';
import type { RenderableAssistantContentBlock } from './types';
import WorkflowExpandedList from './WorkflowExpandedList';

export type WorkflowExpandLevel = 'collapsed' | 'semi' | 'full';
export type WorkflowExpandLevelDefault =
  | WorkflowExpandLevel
  | { completion?: WorkflowExpandLevel; streaming?: WorkflowExpandLevel };

interface WorkflowCollapseProps {
  assistantMessageId: string;
  blocks: RenderableAssistantContentBlock[];
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  workflowChromeComplete?: boolean;
}

const collectTools = (blocks: RenderableAssistantContentBlock[]): ChatToolPayloadWithResult[] =>
  blocks.flatMap((block) => block.tools ?? []);

const statusIconSize = { blockSize: 24, size: 14 };

const WorkflowCollapse = memo<WorkflowCollapseProps>(
  ({ assistantMessageId, blocks, defaultWorkflowExpandLevel, disableEditing }) => {
    const { t } = useTranslation('chat');
    const tools = useMemo(() => collectTools(blocks), [blocks]);
    const complete = areWorkflowToolsComplete(tools);
    const pending = hasPendingIntervention(tools);
    const failed = complete && hasWorkflowError(tools);
    const summary = getWorkflowSummaryText(tools);

    // Whether this assistant message is actively running (streaming / tool
    // calling). In read-only or reloaded views (e.g. the shared topic page)
    // this is false.
    const isToolCalling = useChatStore(
      operationSelectors.isMessageInToolCalling(assistantMessageId),
    );
    const isProcessing = useChatStore(operationSelectors.isMessageProcessing(assistantMessageId));
    // Tools without a result while nothing is executing means the run was
    // interrupted (session closed mid call) — show a terminal state instead of
    // a never-ending loading spinner.
    const interrupted = !complete && !pending && !isToolCalling && !isProcessing;
    const settled = complete || interrupted;

    const initialExpand =
      typeof defaultWorkflowExpandLevel === 'string'
        ? defaultWorkflowExpandLevel
        : (defaultWorkflowExpandLevel?.streaming ?? (settled ? 'collapsed' : 'semi'));
    const [expandLevel, setExpandLevel] = useState<WorkflowExpandLevel>(initialExpand);
    const expanded = pending || expandLevel !== 'collapsed';
    const constrained = expandLevel === 'semi';

    const handleExpandedChange = (keys: Key[]) => {
      const nextExpanded = keys.includes('workflow');
      if (pending && !nextExpanded) return;
      setExpandLevel(nextExpanded ? 'semi' : 'collapsed');
    };

    const title = (
      <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
        <Block
          horizontal
          align="center"
          flex="none"
          height={24}
          justify="center"
          style={{ fontSize: 12 }}
          variant="outlined"
          width={24}
        >
          {complete ? (
            failed ? (
              <Icon color={cssVar.colorError} icon={X} size={statusIconSize.size} />
            ) : (
              <Icon color={cssVar.colorSuccess} icon={Check} size={statusIconSize.size} />
            )
          ) : interrupted ? (
            <Icon color={cssVar.colorTextQuaternary} icon={Unplug} size={statusIconSize.size} />
          ) : (
            <Icon
              color={cssVar.colorTextSecondary}
              icon={LoaderCircle}
              size={statusIconSize.size}
            />
          )}
        </Block>
        <Text
          ellipsis
          style={{ color: settled ? cssVar.colorTextSecondary : cssVar.colorText, minWidth: 0 }}
        >
          {pending
            ? t('workflow.awaitingConfirmation', { defaultValue: 'Awaiting your confirmation' })
            : summary || t('workflow.working', { defaultValue: 'Working...' })}
        </Text>
      </Flexbox>
    );

    return (
      <Accordion
        expandedKeys={expanded ? ['workflow'] : []}
        variant="borderless"
        onExpandedChange={handleExpandedChange}
      >
        <AccordionItem itemKey="workflow" paddingBlock={4} paddingInline={4} title={title}>
          <WorkflowExpandedList
            assistantId={assistantMessageId}
            blocks={blocks}
            constrained={constrained}
            disableEditing={disableEditing}
          />
        </AccordionItem>
      </Accordion>
    );
  },
);

WorkflowCollapse.displayName = 'WorkflowCollapse';

export default WorkflowCollapse;

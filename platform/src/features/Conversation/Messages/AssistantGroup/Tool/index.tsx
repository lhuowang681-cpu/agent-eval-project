import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { isDesktop, LOADING_FLAT } from '@lobechat/const';
import { type ChatToolResult } from '@lobechat/types';
import { AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';

import FeishuAuthRequiredCard from '@/features/FeishuAuth/FeishuAuthRequiredCard';
import FeishuCliAuthRequiredCard from '@/features/FeishuAuth/FeishuCliAuthRequiredCard';
import dynamic from '@/libs/next/dynamic';
import { extractLarkCliMissingScopes, isLarkCliAuthError } from '@/services/electron/feishuCli';
import { isFeishuAuthRequiredError } from '@/services/feishuToken';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { dataSelectors, useConversationStore } from '../../../store';
import { ToolErrorBoundary } from '../../Tool/ErrorBoundary';
import Actions from './Actions';
import Inspectors from './Inspector';

const Debug = dynamic(() => import('./Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

const Detail = dynamic(() => import('./Detail'), {
  loading: () => <Skeleton.Block active height={120} width={'100%'} />,
  ssr: false,
});

export interface GroupToolProps {
  assistantMessageId: string;
  disableEditing?: boolean;
  id: string;
}

const Tool = memo<GroupToolProps>(({ assistantMessageId, disableEditing, id }) => {
  const tool = useConversationStore(dataSelectors.getToolInBlock(assistantMessageId, id));
  const apiName = tool?.apiName ?? '';
  const identifier = tool?.identifier ?? '';
  const requestArgs = tool?.arguments;
  const intervention = tool?.intervention;
  const result = tool?.result;
  const type = tool?.type;
  const toolMessageId = tool?.result_msg_id;

  const toolMessage = useConversationStore((s) =>
    toolMessageId ? dataSelectors.getDbMessageById(toolMessageId)(s) : undefined,
  );

  const effectiveResult = useMemo(() => {
    if (!toolMessage) return result;

    return {
      content: toolMessage.content ?? result?.content ?? '',
      error: toolMessage.pluginError || toolMessage.error,
      id: result?.id ?? id,
      state: toolMessage.pluginState ?? result?.state,
    } satisfies ChatToolResult;
  }, [id, result, toolMessage]);

  // Get renderDisplayControl from manifest
  const renderDisplayControl = useToolStore(
    toolSelectors.getRenderDisplayControl(identifier, apiName),
  );
  const [showDebug, setShowDebug] = useState(false);
  const [showToolRender, setShowToolRender] = useState(false);
  // Controls switching between custom render and fallback ArgumentRender
  const [showCustomToolRender, setShowCustomToolRender] = useState(true);

  const isPending = intervention?.status === 'pending';
  const isReject = intervention?.status === 'rejected';
  const isAbort = intervention?.status === 'aborted';
  const needExpand = renderDisplayControl !== 'collapsed' || isPending;
  const isAlwaysExpand = renderDisplayControl === 'alwaysExpand';

  let isArgumentsStreaming = false;
  try {
    JSON.parse(requestArgs || '{}');
  } catch {
    isArgumentsStreaming = true;
  }

  const hasStreamingRenderer = !!getBuiltinStreaming(identifier, apiName);
  const forceShowStreamingRender = isArgumentsStreaming && hasStreamingRenderer;

  // Get precise tool calling state from operation
  const isToolCallingFromOperation = useChatStore(
    operationSelectors.isMessageInToolCalling(assistantMessageId),
  );
  const isAssistantMessageBusy = useChatStore(
    operationSelectors.isMessageProcessing(assistantMessageId),
  );

  const isFeishuAuthRequired =
    isFeishuAuthRequiredError(effectiveResult?.error) && !!effectiveResult.error.authUrl;

  // Desktop：lark-cli（经 execScript 跑）报鉴权/缺 scope 错误时，就地渲染 device-flow 授权卡片
  // 不限定 identifier：runCommand（lobe-local-system）等任何工具都可能触发 lark-cli 报错
  const isFeishuCliAuthRequired = isDesktop && isLarkCliAuthError(effectiveResult?.content);

  const showAuthCard = isFeishuAuthRequired || isFeishuCliAuthRequired;

  // Fallback: arguments completed but no final result yet
  const hasError = !!effectiveResult?.error && !showAuthCard;
  const hasFinishedResult =
    hasError ||
    (!!effectiveResult && effectiveResult.content !== LOADING_FLAT && !!effectiveResult.content);
  const looksLikeWaitingForToolResult =
    !hasError && !showAuthCard && !isArgumentsStreaming && !hasFinishedResult;
  const isToolCallingFallback = looksLikeWaitingForToolResult && isAssistantMessageBusy;
  const isToolCalling = !hasFinishedResult && (isToolCallingFromOperation || isToolCallingFallback);
  const toolCallStartTime = useChatStore(operationSelectors.getRunningToolCallStartTime(id));

  const hasCustomRender = !!getBuiltinRender(identifier, apiName);
  // Only allow toggle when has custom render and not in pending/reject/abort state
  const canToggleCustomToolRender = hasCustomRender && !isPending && !isReject && !isAbort;

  // Handle expand state changes
  const handleExpand = (expand?: boolean) => {
    // Block collapse action when alwaysExpand is set
    if (isAlwaysExpand && expand === false) {
      return;
    }
    // When collapsing, also turn off debug mode so the accordion can actually collapse
    if (expand === false) {
      setShowDebug(false);
    }
    setShowToolRender(!!expand);
  };

  useEffect(() => {
    if (needExpand) {
      setTimeout(() => handleExpand(true), 100);
    }
  }, [needExpand]);

  if (!tool) return null;

  const isToolDetailExpand =
    !showAuthCard && (forceShowStreamingRender || showToolRender || showDebug);

  return (
    <Flexbox gap={8}>
      <AccordionItem
        expand={isToolDetailExpand}
        itemKey={id}
        paddingBlock={4}
        paddingInline={4}
        action={
          !disableEditing && (
            <Actions
              assistantMessageId={assistantMessageId}
              canToggleCustomToolRender={canToggleCustomToolRender}
              identifier={identifier}
              setShowCustomToolRender={setShowCustomToolRender}
              setShowDebug={setShowDebug}
              showCustomToolRender={showCustomToolRender}
              showDebug={showDebug}
            />
          )
        }
        title={
          <Inspectors
            apiName={apiName}
            arguments={requestArgs}
            identifier={identifier}
            intervention={intervention}
            isArgumentsStreaming={isArgumentsStreaming}
            isToolCalling={isToolCalling}
            result={effectiveResult}
            toolCallId={id}
            toolCallStartTime={toolCallStartTime}
          />
        }
        onExpandChange={handleExpand}
      >
        {!showAuthCard && (
          <Flexbox gap={8} paddingBlock={8}>
            {showDebug && (
              <Debug
                apiName={apiName}
                identifier={identifier}
                intervention={intervention}
                requestArgs={requestArgs}
                result={result}
                toolCallId={id}
                type={type}
              />
            )}
            <ToolErrorBoundary apiName={apiName} identifier={identifier}>
              <Detail
                apiName={apiName}
                arguments={requestArgs}
                disableEditing={disableEditing}
                identifier={identifier}
                intervention={intervention}
                isArgumentsStreaming={isArgumentsStreaming}
                isToolCalling={isToolCalling}
                messageId={assistantMessageId}
                result={effectiveResult}
                showCustomToolRender={showCustomToolRender}
                toolCallId={id}
                toolMessageId={toolMessageId}
                type={type}
              />
            </ToolErrorBoundary>
            <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
          </Flexbox>
        )}
      </AccordionItem>
      {isFeishuAuthRequired && <FeishuAuthRequiredCard authUrl={effectiveResult.error.authUrl} />}
      {isFeishuCliAuthRequired && (
        <FeishuCliAuthRequiredCard scopes={extractLarkCliMissingScopes(effectiveResult?.content)} />
      )}
    </Flexbox>
  );
});

Tool.displayName = 'GroupTool';

export default Tool;

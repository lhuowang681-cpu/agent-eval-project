import { getBuiltinInspector } from '@lobechat/builtin-tools/inspectors';
import { type ToolIntervention } from '@lobechat/types';
import { safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { isFeishuAuthRequiredError } from '@/services/feishuToken';

import ExecutionTime from './ExecutionTime';
import StatusIndicator from './StatusIndicator';
import ToolTitle from './ToolTitle';

interface InspectorProps {
  apiName: string;
  arguments?: string;
  identifier: string;
  intervention?: ToolIntervention;
  /**
   * Whether the tool arguments are currently streaming
   */
  isArgumentsStreaming?: boolean;
  isToolCalling?: boolean;
  result?: { content: string | null; error?: any; state?: any };
  toolCallId: string;
  toolCallStartTime?: number;
}

const Inspectors = memo<InspectorProps>(
  ({
    identifier,
    apiName,
    arguments: argsStr,
    result,
    intervention,
    isArgumentsStreaming,
    isToolCalling,
    toolCallId,
    toolCallStartTime,
  }) => {
    const isFeishuAuthPending = isFeishuAuthRequiredError(result?.error);
    const hasError = !!result?.error && !isFeishuAuthPending;
    const hasSuccessResult = !!result?.content && result.content !== LOADING_FLAT;
    const hasResult = hasSuccessResult || hasError;

    const isPending = intervention?.status === 'pending';
    const isAborted = intervention?.status === 'aborted';

    // Distinguish between arguments streaming and tool executing
    const isToolExecuting = Boolean(isToolCalling) && !isPending && !isAborted;
    // A persisted tool call with no result that is not actively executing means
    // the run was interrupted (e.g. the session/desktop process was closed mid
    // call). Treat it as a terminal state so it doesn't spin forever — most
    // visible in read-only views like the shared topic page.
    const isInterrupted =
      !hasResult && !isPending && !isAborted && !isArgumentsStreaming && !isToolExecuting;
    const isTitleLoading = isArgumentsStreaming || isToolExecuting;
    const showExecutionTimer = isToolExecuting && !isArgumentsStreaming;

    // Check for custom inspector renderer
    const CustomInspector = getBuiltinInspector(identifier, apiName);

    if (CustomInspector) {
      const args = safeParseJSON(argsStr);
      const partialJson = safeParsePartialJSON(argsStr);
      return (
        <Flexbox allowShrink horizontal align={'center'} gap={6}>
          <StatusIndicator
            intervention={intervention}
            isInterrupted={isInterrupted}
            result={result}
          />
          <CustomInspector
            apiName={apiName}
            args={args || {}}
            identifier={identifier}
            isArgumentsStreaming={isArgumentsStreaming}
            isLoading={isTitleLoading}
            partialArgs={partialJson}
            pluginState={result?.state}
            result={result}
          />
          <ExecutionTime
            isExecuting={showExecutionTimer}
            startTime={toolCallStartTime}
            timerKey={toolCallId}
          />
        </Flexbox>
      );
    }

    const args = safeParseJSON(argsStr);
    const partialJson = safeParsePartialJSON(argsStr);

    return (
      <Flexbox horizontal align={'center'} gap={6}>
        <StatusIndicator
          intervention={intervention}
          isInterrupted={isInterrupted}
          result={result}
        />
        <ToolTitle
          apiName={apiName}
          args={args || undefined}
          identifier={identifier}
          isAborted={isAborted || isInterrupted}
          isLoading={isTitleLoading}
          partialArgs={partialJson || undefined}
        />
        <ExecutionTime
          isExecuting={showExecutionTimer}
          startTime={toolCallStartTime}
          timerKey={toolCallId}
        />
      </Flexbox>
    );
  },
);

export default Inspectors;

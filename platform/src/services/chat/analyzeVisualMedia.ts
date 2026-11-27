import {
  type AnalyzeVisualMediaParams,
  buildAnalyzeVisualMediaContent,
  createUrlVisualFileItems,
  createVisualFileItems,
  formatVisualMediaUrlValidationError,
  getUnexpectedAnalyzeVisualMediaArgumentKeys,
  hasUserVisualFiles,
  normalizeAnalyzeVisualMediaInput,
  selectVisualFileItems,
  validateVisualMediaUrls,
  type VisualFileItem,
} from '@lobechat/builtin-tool-lobe-agent';
import { type BuiltinToolResult } from '@lobechat/types';

import { serverConfigSelectors } from '@/store/serverConfig';

const getVisualUnderstandingConfig = () => {
  if (typeof window === 'undefined' || !window.global_serverConfigStore) return undefined;

  const state = window.global_serverConfigStore.getState();

  // Primary: qconfig-driven systemAgent.visualUnderstanding (guaranteed to be configured
  // in production, aligned with topic/thread/etc.). Legacy serverConfig.visualUnderstanding
  // (env-driven) remains as a fail-safe.
  const systemAgent = serverConfigSelectors.systemAgent(state);
  const visualFromSystemAgent = systemAgent.visualUnderstanding;
  if (visualFromSystemAgent?.provider && visualFromSystemAgent.model) {
    return { model: visualFromSystemAgent.model, provider: visualFromSystemAgent.provider };
  }

  return serverConfigSelectors.visualUnderstanding(state);
};

interface VisualSourceMessage {
  parentId?: string;
}

const isVisualSourceMessage = (message: unknown): message is VisualSourceMessage =>
  !!message && typeof message === 'object';

const createAbortController = (signal?: AbortSignal) => {
  const abortController = new AbortController();

  if (signal?.aborted) {
    abortController.abort();
    return abortController;
  }

  signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  return abortController;
};

export interface AnalyzeVisualMediaContext {
  messageId: string;
  signal?: AbortSignal;
  sourceMessageId?: string;
}

/**
 * Client-side implementation of `lobe-agent`'s `analyzeVisualMedia` API.
 * Not yet wired into a builtin tool executor (the `lobe-agent` tool doesn't
 * exist yet — that's C4). Standalone, fully-testable function ready to be
 * plugged into an executor once the tool is packaged.
 */
export const analyzeVisualMedia = async (
  params: AnalyzeVisualMediaParams,
  context: AnalyzeVisualMediaContext,
): Promise<BuiltinToolResult> => {
  const config = getVisualUnderstandingConfig();

  if (!config?.provider || !config.model) {
    return {
      error: {
        message: 'Visual understanding model is not configured',
        type: 'PluginSettingsInvalid',
      },
      success: false,
    };
  }

  if (!params.question?.trim()) {
    return {
      error: { message: '`question` is required', type: 'InvalidToolArguments' },
      success: false,
    };
  }

  const { requestedRefs, requestedUrls } = normalizeAnalyzeVisualMediaInput(
    params as unknown as Record<PropertyKey, unknown>,
  );
  if (requestedRefs.length === 0 && requestedUrls.length === 0) {
    const unexpectedKeys = getUnexpectedAnalyzeVisualMediaArgumentKeys(
      params as unknown as Record<PropertyKey, unknown>,
    );
    const aliasHint = unexpectedKeys.length > 0 ? ` Do not use ${unexpectedKeys.join(', ')}.` : '';

    return {
      error: {
        message: `Either \`refs\` or \`urls\` is required and must include at least one visual file ref or media URL.${aliasHint}`,
        type: 'InvalidToolArguments',
      },
      success: false,
    };
  }

  const urlValidation = validateVisualMediaUrls(requestedUrls);
  const urlValidationError = formatVisualMediaUrlValidationError(urlValidation);
  if (urlValidationError) {
    return {
      error: {
        message: urlValidationError,
        type: 'InvalidToolArguments',
      },
      success: false,
    };
  }

  const selectedUrls = createUrlVisualFileItems(urlValidation.validUrls);
  let selectedRefs: VisualFileItem[] = [];

  if (requestedRefs.length > 0) {
    const [{ getChatStoreState }, { dbMessageSelectors }] = await Promise.all([
      import('@/store/chat'),
      import('@/store/chat/selectors'),
    ]);

    const chatState = getChatStoreState();
    const sourceCandidate =
      context.sourceMessageId &&
      dbMessageSelectors.getDbMessageById(context.sourceMessageId)(chatState);
    const toolMessage = dbMessageSelectors.getDbMessageById(context.messageId)(chatState);
    const assistantMessage =
      isVisualSourceMessage(toolMessage) &&
      toolMessage.parentId &&
      dbMessageSelectors.getDbMessageById(toolMessage.parentId)(chatState);
    const parentUserMessage =
      isVisualSourceMessage(assistantMessage) &&
      assistantMessage.parentId &&
      dbMessageSelectors.getDbMessageById(assistantMessage.parentId)(chatState);
    const sourceMessage = hasUserVisualFiles(sourceCandidate)
      ? sourceCandidate
      : hasUserVisualFiles(parentUserMessage)
        ? parentUserMessage
        : dbMessageSelectors.latestUserMessage(chatState);
    const activeVisualMessages = dbMessageSelectors
      .activeDbMessages(chatState)
      .filter(hasUserVisualFiles);
    const visualMessages = [
      ...(hasUserVisualFiles(sourceMessage) ? [sourceMessage] : []),
      ...activeVisualMessages.filter((message) => message.id !== sourceMessage?.id),
    ];
    const files = visualMessages.flatMap((message) =>
      createVisualFileItems(message, message.imageList, message.videoList),
    );

    if (files.length === 0) {
      return {
        error: {
          message: 'No visual files are available in the current message',
          type: 'VisualFilesNotFound',
        },
        success: false,
      };
    }

    const { invalidRefs, selected } = selectVisualFileItems(files, requestedRefs);

    if (invalidRefs?.length) {
      const availableRefs = files.map((file) => file.ref);

      return {
        content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}`,
        error: { message: 'Unknown visual file refs', type: 'InvalidToolArguments' },
        state: { availableFiles: files, invalidRefs },
        success: false,
      };
    }

    selectedRefs = selected;
  }

  const selectedItems = [...selectedRefs, ...selectedUrls];

  if (selectedItems.length === 0) {
    return {
      error: { message: 'No visual files selected', type: 'InvalidToolArguments' },
      success: false,
    };
  }

  let content = '';
  let error: { message?: string } | undefined;
  let usage: unknown;
  const abortController = createAbortController(context.signal);
  const { chatService } = await import('@/services/chat');
  await chatService.getChatCompletion(
    {
      messages: [
        {
          content: buildAnalyzeVisualMediaContent(selectedItems, params.question, {
            includeFallbackInstruction: true,
            includeFileSummary: true,
          }),
          role: 'user' as const,
        },
      ],
      model: config.model,
      provider: config.provider,
    },
    {
      onErrorHandle: (err) => {
        error = err;
      },
      onFinish: async (text, ctx) => {
        content = text || content;
        usage = ctx.usage;
      },
      onMessageHandle: (chunk) => {
        if (chunk.type === 'text') content += chunk.text || '';
      },
      signal: abortController.signal,
    },
  );

  if (abortController.signal.aborted) {
    return { stop: true, success: false };
  }

  if (error) {
    return {
      error: {
        body: error,
        message: error.message ?? 'Visual understanding request failed',
        type: 'PluginServerError',
      },
      success: false,
    };
  }

  return {
    content,
    state: {
      files: selectedItems,
      model: config.model,
      provider: config.provider,
      usage,
    },
    success: true,
  };
};

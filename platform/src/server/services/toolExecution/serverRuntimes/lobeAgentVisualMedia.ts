import {
  type AnalyzeVisualMediaParams,
  buildAnalyzeVisualMediaContent,
  createUrlVisualFileItems,
  createVisualFileItems,
  formatVisualMediaUrlValidationError,
  hasUserVisualFiles,
  normalizeAnalyzeVisualMediaInput,
  selectVisualFileItems,
  validateVisualMediaUrls,
  type VisualFileItem,
} from '@lobechat/builtin-tool-lobe-agent';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatStreamPayload, consumeStreamUntilDone } from '@lobechat/model-runtime';
import { type BuiltinServerRuntimeOutput, RequestTrigger } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { toolsEnv } from '@/envs/tools';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';
import { getServiceModelTaskConfig } from '@/server/services/serviceModel/config';

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

const getModelAbilities = async (model: string, provider: string) => {
  const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

  return LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === model && item.providerId === provider)
    ?.abilities;
};

export interface AnalyzeVisualMediaContext {
  messageId?: string;
  serverDB: LobeChatDatabase;
  topicId?: string;
  userId: string;
}

/**
 * Server-side implementation of `lobe-agent`'s `analyzeVisualMedia` API.
 * Wired into the `lobe-agent` `ServerRuntimeRegistration` (see `lobeAgent.ts`).
 *
 * Scope note: only resolves visual files from the current topic (via
 * `MessageModel.query({ topicId })`), unlike lobehub's version which also
 * scopes by thread/group/agent/session for sub-agent and group-chat runs.
 * Those scenarios depend on infrastructure this project hasn't ported yet,
 * so they're intentionally out of scope here.
 */
export const analyzeVisualMedia = async (
  params: AnalyzeVisualMediaParams,
  context: AnalyzeVisualMediaContext,
): Promise<BuiltinServerRuntimeOutput> => {
  // Primary: qconfig-driven serviceModel.systemAgent.visualUnderstanding (guaranteed to be
  // configured in production). Legacy VISUAL_UNDERSTANDING_* env vars remain as an emergency
  // fail-safe in case qconfig itself is unavailable.
  const taskConfig = getServiceModelTaskConfig('visualUnderstanding');
  const provider = taskConfig.provider || toolsEnv.VISUAL_UNDERSTANDING_PROVIDER;
  const model = taskConfig.model || toolsEnv.VISUAL_UNDERSTANDING_MODEL;

  if (!provider || !model) {
    return buildError(
      'Visual understanding is not configured. Set serviceModel.systemAgent.visualUnderstanding in qconfig, or the VISUAL_UNDERSTANDING_PROVIDER / VISUAL_UNDERSTANDING_MODEL env vars.',
      'VISUAL_UNDERSTANDING_NOT_CONFIGURED',
    );
  }

  if (!params.question || typeof params.question !== 'string') {
    return buildError('question is required.', 'INVALID_ARGUMENTS');
  }

  const { requestedRefs, requestedUrls } = normalizeAnalyzeVisualMediaInput(
    params as unknown as Record<PropertyKey, unknown>,
  );
  if (requestedRefs.length === 0 && requestedUrls.length === 0) {
    return buildError(
      'Either refs or urls is required and must include at least one visual file ref or media URL.',
      'INVALID_ARGUMENTS',
    );
  }

  const urlValidation = validateVisualMediaUrls(requestedUrls);
  const urlValidationError = formatVisualMediaUrlValidationError(urlValidation);
  if (urlValidationError) {
    return buildError(urlValidationError, 'UNSUPPORTED_VISUAL_MEDIA_URLS');
  }

  const selectedUrlItems = createUrlVisualFileItems(urlValidation.validUrls);
  let selectedRefItems: VisualFileItem[] = [];

  if (requestedRefs.length > 0) {
    if (!context.messageId) {
      return buildError(
        'Cannot resolve visual file refs without a source message.',
        'SOURCE_MESSAGE_NOT_FOUND',
      );
    }

    const fileService = new FileService(context.serverDB, context.userId);
    const messageModel = new MessageModel(context.serverDB, context.userId);
    const postProcessUrl = (path: string | null, file: { fileType: string; id?: string | null }) =>
      fileService.getFileAccessUrl({ id: file.id, url: path });

    const [sourceMessage] = await messageModel.queryByIds([context.messageId], {
      postProcessUrl,
    });

    if (!sourceMessage) {
      return buildError(
        `Source message not found: ${context.messageId}`,
        'SOURCE_MESSAGE_NOT_FOUND',
      );
    }

    const scopeMessages = context.topicId
      ? await messageModel.query({ topicId: context.topicId }, { postProcessUrl })
      : [sourceMessage];

    const orderedVisualMessages = [
      ...(hasUserVisualFiles(sourceMessage) ? [sourceMessage] : []),
      ...scopeMessages.filter(
        (message) => message.id !== sourceMessage.id && hasUserVisualFiles(message),
      ),
    ];

    const visualItems = orderedVisualMessages.flatMap((message) =>
      createVisualFileItems(message, message.imageList, message.videoList),
    );

    if (visualItems.length === 0) {
      return buildError('No visual files are attached to the current message.', 'NO_VISUAL_FILES');
    }

    const { availableRefs, invalidRefs, selected } = selectVisualFileItems(
      visualItems,
      requestedRefs,
    );

    if (invalidRefs.length > 0) {
      return buildError(
        `Unknown visual file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}.`,
        'UNKNOWN_VISUAL_FILE_REFS',
      );
    }

    selectedRefItems = selected;
  }

  const selectedItems = [...selectedRefItems, ...selectedUrlItems];

  if (selectedItems.length === 0) {
    return buildError('No visual files selected.', 'NO_VISUAL_FILES_SELECTED');
  }

  const abilities = await getModelAbilities(model, provider);
  const hasImages = selectedItems.some((item) => item.type === 'image');
  const hasVideos = selectedItems.some((item) => item.type === 'video');

  if (hasImages && abilities?.vision === false) {
    return buildError(
      `Configured visual understanding model "${provider}/${model}" does not support image vision.`,
      'VISUAL_MODEL_IMAGE_UNSUPPORTED',
    );
  }

  if (hasVideos && abilities?.video === false) {
    return buildError(
      `Configured visual understanding model "${provider}/${model}" does not support video understanding.`,
      'VISUAL_MODEL_VIDEO_UNSUPPORTED',
    );
  }

  let content = '';
  let usage: unknown;
  const runtime = await initModelRuntimeFromDB(context.serverDB, context.userId, provider);

  const messageContent = buildAnalyzeVisualMediaContent(selectedItems, params.question);
  const payload = {
    messages: [
      {
        content: messageContent,
        role: 'user' as const,
      },
    ],
    model,
    stream: false,
  } satisfies ChatStreamPayload;

  const response = await runtime.chat(payload, {
    callback: {
      onCompletion: (data) => {
        usage = data.usage;
      },
      onContentPart: (part) => {
        if (part.partType === 'text') content += part.content;
      },
      onText: (text) => {
        content += text;
      },
    },
    metadata: {
      trigger: RequestTrigger.VisualAnalysis,
    },
  });

  await consumeStreamUntilDone(response);

  return {
    content: content.trim(),
    state: {
      files: selectedItems.map(({ ref, id, type, name }) => ({ id, name, ref, type })),
      model,
      provider,
      trigger: RequestTrigger.VisualAnalysis,
      usage,
    },
    success: true,
  };
};

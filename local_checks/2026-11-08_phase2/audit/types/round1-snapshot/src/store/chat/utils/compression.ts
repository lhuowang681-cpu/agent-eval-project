import type { CompressionGroupMetadata, ConversationContext, UIChatMessage } from '@lobechat/types';

import type { Operation } from '../slices/operation/types';

export const isCompressionOperationType = (type?: string) =>
  type === 'contextCompression' || type === 'generateSummary';

export interface CompressionPlanOptions {
  dbMessages?: UIChatMessage[];
  mode: 'auto' | 'manual';
  preserveRecentCount?: number;
}

export interface CompressionPlan {
  messageIdsToCompress: string[];
  messagesToSummarize: UIChatMessage[];
  preservedMessages: UIChatMessage[];
}

const DEFAULT_MANUAL_PRESERVE_RECENT_COUNT = 1;
const DEFAULT_AUTO_PRESERVE_RECENT_COUNT = 0;

const isCompressedGroupMessage = (message: UIChatMessage) => message.role === 'compressedGroup';

const getMessageIdSet = (messages: UIChatMessage[]) =>
  new Set(messages.map((message) => message.id).filter((id): id is string => Boolean(id)));

const includesMessage = (messages: UIChatMessage[], target: UIChatMessage) =>
  messages.some(
    (message) =>
      message === target || (Boolean(message.id) && Boolean(target.id) && message.id === target.id),
  );

export const buildCompressionPlan = (
  messages: UIChatMessage[],
  options: CompressionPlanOptions,
): CompressionPlan => {
  const eligibleMessages = messages.filter((message) => !isCompressedGroupMessage(message));
  const preserveRecentCount =
    options.preserveRecentCount ??
    (options.mode === 'manual'
      ? DEFAULT_MANUAL_PRESERVE_RECENT_COUNT
      : DEFAULT_AUTO_PRESERVE_RECENT_COUNT);

  const preservedMessages: UIChatMessage[] = [];

  const preserveMessage = (message: UIChatMessage) => {
    if (!includesMessage(preservedMessages, message)) {
      preservedMessages.push(message);
    }
  };

  if (options.mode === 'auto' && eligibleMessages.length > 1) {
    const latestMessage = eligibleMessages.at(-1);
    if (latestMessage?.role === 'user') {
      preserveMessage(latestMessage);
    }
  }

  if (preserveRecentCount > 0) {
    let preservedCount = 0;
    for (const message of [...eligibleMessages].reverse()) {
      if (includesMessage(preservedMessages, message)) continue;

      preserveMessage(message);
      preservedCount++;

      if (preservedCount >= preserveRecentCount) break;
    }
  }

  const preservedMessageIds = getMessageIdSet(preservedMessages);
  const messagesToSummarize = eligibleMessages.filter((message) =>
    message.id ? !preservedMessageIds.has(message.id) : !preservedMessages.includes(message),
  );

  const idSourceMessages = options.dbMessages ?? messages;
  const messageIdsToCompress = idSourceMessages
    .filter((message) => !isCompressedGroupMessage(message))
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id) && !preservedMessageIds.has(id));

  return {
    messageIdsToCompress,
    messagesToSummarize,
    preservedMessages,
  };
};

export const getCompressionCandidateMessageIds = (messages: UIChatMessage[]) =>
  messages
    .filter((message) => message.role !== 'compressedGroup')
    .map((message) => message.id)
    .filter(Boolean);

export const createPendingCompressedGroup = ({
  agentId,
  content = '...',
  groupId,
  id,
  threadId,
  topicId,
}: {
  agentId: string;
  content?: string;
  groupId?: string | null;
  id: string;
  threadId?: string | null;
  topicId?: string | null;
}): UIChatMessage => {
  const now = Date.now();
  const metadata: CompressionGroupMetadata = { expanded: true };

  return {
    agentId,
    compressedMessages: [],
    content,
    createdAt: now,
    groupId: groupId ?? undefined,
    id,
    metadata: metadata as UIChatMessage['metadata'],
    role: 'compressedGroup',
    threadId: threadId ?? undefined,
    topicId: topicId ?? undefined,
    updatedAt: now,
  };
};

export const hasRunningCompressionOperation = (
  operations: Operation[],
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
) =>
  operations.some((operation) => {
    if (operation.status !== 'running' || !isCompressionOperationType(operation.type)) return false;

    return (
      operation.context.agentId === context.agentId &&
      (operation.context.groupId ?? null) === (context.groupId ?? null) &&
      (operation.context.threadId ?? null) === (context.threadId ?? null) &&
      (operation.context.topicId ?? null) === (context.topicId ?? null)
    );
  });

import { z } from 'zod';

import type { BaseDataModel } from '../meta';

// Type definitions
export type ShareVisibility = 'private' | 'link';

export type TimeGroupId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | `${number}-${string}`
  | `${number}`;

export enum TopicDisplayMode {
  ByCreatedTime = 'byTime',
  ByUpdatedTime = 'byUpdatedTime',
  Flat = 'flat',
  // AscMessages = 'ascMessages',
  // DescMessages = 'descMessages',
}

export type TopicGroupMode = 'byTime' | 'byProject' | 'flat' | 'byStatus';
export type TopicSortBy = 'createdAt' | 'updatedAt';

/**
 * Server-side ordering for the topic list query.
 */
export type TopicQuerySortBy = 'updatedAt' | 'status';

export const TOPIC_STATUSES = [
  'active',
  'running',
  'paused',
  'waitingForHuman',
  'failed',
  'completed',
  'archived',
  'unread',
] as const;

export const chatTopicStatusSchema = z.enum(TOPIC_STATUSES);

export type ChatTopicStatus = z.infer<typeof chatTopicStatusSchema>;

export interface GroupedTopic {
  children: ChatTopic[];
  id: string;
  title?: string;
}

export interface TopicUserMemoryExtractRunState {
  error?: string;
  lastMessageAt?: string;
  lastRunAt?: string;
  messageCount?: number;
  processedMemoryCount?: number;
  traceId?: string;
}

export interface ChatTopicBotContext {
  applicationId: string;
  /**
   * Whether the message sender is the bot owner. Computed at the bot
   * router/dispatcher entry point as `senderExternalUserId === settings.userId`.
   * Fail-closed: when the sender can't be resolved this stays falsy.
   */
  isOwner?: boolean;
  /**
   * Set when the run originated from a shared Messenger install. The value is
   * the messenger installation key (`<platform>:<tenantId>` or
   * `<platform>:singleton`). Unused in the Feishu-only deployment.
   */
  messengerInstallationKey?: string;
  platform: string;
  platformThreadId: string;
  /**
   * Platform-assigned ID of the actual sender of the inbound message.
   * Distinct from `applicationId` (the bot itself).
   */
  senderExternalUserId?: string;
}

export interface ChatTopicMetadata {
  bot?: ChatTopicBotContext;
  /**
   * Cron job ID that triggered this topic creation (if created by scheduled task)
   */
  cronJobId?: string;
  model?: string;
  provider?: string;
  /**
   * Currently running Gateway operation on this topic.
   * Set when agent execution starts, cleared when it completes/fails.
   */
  runningOperation?: {
    assistantMessageId: string;
    completionWebhook?: {
      body?: Record<string, unknown>;
      delivery?: 'fetch' | 'qstash';
      url: string;
    };
    operationId: string;
    scope?: string;
    threadId?: string | null;
  } | null;
  /**
   * Task ID that triggered this topic creation (if created by an agent task run)
   */
  taskId?: string;
  userMemoryExtractRunState?: TopicUserMemoryExtractRunState;
  userMemoryExtractStatus?: 'pending' | 'completed' | 'failed';
  /**
   * Local System working directory (desktop only)
   * Priority is higher than Agent-level settings
   */
  workingDirectory?: string;
}

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  completedAt?: Date | null;
  cost?: number | null;
  description?: string | null;
  favorite?: boolean;
  firstUserMessage?: string | null;
  historySummary?: string;
  messageCount?: number | null;
  metadata?: ChatTopicMetadata;
  sessionId?: string;
  status?: ChatTopicStatus | null;
  title: string;
  tokenUsage?: number | null;
  trigger?: string | null;
}

export type ChatTopicMap = Record<string, ChatTopic>;

export interface TopicRankItem {
  agentId: string | null;
  count: number;
  groupId: string | null;
  id: string;
  sessionId: string | null;
  title: string | null;
}

export interface RecentTopicAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface RecentTopicGroupMember {
  avatar: string | null;
  backgroundColor: string | null;
}

export interface RecentTopicGroup {
  id: string;
  members: RecentTopicGroupMember[];
  title: string | null;
}

export interface RecentTopic {
  agent: RecentTopicAgent | null;
  group: RecentTopicGroup | null;
  id: string;
  title: string | null;
  type: 'agent' | 'group';
  updatedAt: Date;
}

export interface CreateTopicParams {
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  sessionId?: string | null;
  title: string;
}

export interface QueryTopicParams {
  agentId?: string | null;
  current?: number;
  /**
   * Exclude topics by status (e.g. ['completed'])
   */
  excludeStatuses?: string[];
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Include only topics whose trigger matches one of these values.
   */
  includeTriggers?: string[];
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
  sortBy?: TopicQuerySortBy;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
  /**
   * When true, returns card-detail fields (firstUserMessage, messageCount, etc.)
   */
  withDetails?: boolean;
}

/**
 * Shared message data for public sharing
 */
export interface SharedMessage {
  content: string;
  createdAt: Date;
  id: string;
  role: string;
}

/**
 * Shared topic data returned by public API
 */
export interface SharedTopicData {
  agentId: string | null;
  agentMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    marketIdentifier?: string | null;
    slug?: string | null;
    title?: string | null;
  };
  groupId: string | null;
  groupMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    createdAt?: Date | null;
    members?: {
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      title: string | null;
    }[];
    title?: string | null;
    updatedAt?: Date | null;
    userId?: string | null;
  };
  shareId: string;
  title: string | null;
  topicId: string;
  visibility: ShareVisibility;
}

/**
 * Topic share info returned to the owner
 */
export interface TopicShareInfo {
  id: string;
  topicId: string;
  visibility: ShareVisibility;
}

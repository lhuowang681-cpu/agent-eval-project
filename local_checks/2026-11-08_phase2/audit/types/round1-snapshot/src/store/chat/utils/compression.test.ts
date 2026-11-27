import { describe, expect, it } from 'vitest';

import { type Operation } from '../slices/operation/types';
import {
  buildCompressionPlan,
  createPendingCompressedGroup,
  getCompressionCandidateMessageIds,
  hasRunningCompressionOperation,
  isCompressionOperationType,
} from './compression';

describe('compression utils', () => {
  it('should treat contextCompression and generateSummary as compression operations', () => {
    expect(isCompressionOperationType('contextCompression')).toBe(true);
    expect(isCompressionOperationType('generateSummary')).toBe(true);
    expect(isCompressionOperationType('sendMessage')).toBe(false);
  });

  it('should exclude compressedGroup ids from compression candidates', () => {
    expect(
      getCompressionCandidateMessageIds([
        { id: 'user-1', role: 'user' } as any,
        { id: 'group-1', role: 'compressedGroup' } as any,
        { id: 'tool-1', role: 'tool' } as any,
      ]),
    ).toEqual(['user-1', 'tool-1']);
  });

  it('should preserve the latest user message for automatic compression', () => {
    const messages = [
      { id: 'history-user', role: 'user', content: 'old question' },
      { id: 'history-assistant', role: 'assistant', content: 'old answer' },
      { id: 'current-user', role: 'user', content: 'answer this exact question' },
    ] as any;

    const plan = buildCompressionPlan(messages, { mode: 'auto' });

    expect(plan.messageIdsToCompress).toEqual(['history-user', 'history-assistant']);
    expect(plan.messagesToSummarize.map((message) => message.id)).toEqual([
      'history-user',
      'history-assistant',
    ]);
    expect(plan.preservedMessages.map((message) => message.id)).toEqual(['current-user']);
  });

  it('should preserve the recent tail for manual compression', () => {
    const messages = [
      { id: 'history-user', role: 'user', content: 'old question' },
      { id: 'history-assistant', role: 'assistant', content: 'old answer' },
      { id: 'latest-assistant', role: 'assistant', content: 'recent answer' },
    ] as any;

    const plan = buildCompressionPlan(messages, { mode: 'manual', preserveRecentCount: 1 });

    expect(plan.messageIdsToCompress).toEqual(['history-user', 'history-assistant']);
    expect(plan.preservedMessages.map((message) => message.id)).toEqual(['latest-assistant']);
  });

  it('should never include compressedGroup messages in the compression plan', () => {
    const messages = [
      { id: 'group-1', role: 'compressedGroup', content: 'existing summary' },
      { id: 'history-user', role: 'user', content: 'old question' },
      { id: 'current-user', role: 'user', content: 'current question' },
    ] as any;

    const plan = buildCompressionPlan(messages, { mode: 'auto' });

    expect(plan.messageIdsToCompress).toEqual(['history-user']);
    expect(plan.messagesToSummarize.map((message) => message.id)).toEqual(['history-user']);
    expect(plan.preservedMessages.map((message) => message.id)).toEqual(['current-user']);
  });

  it('should detect running compression operations in the same conversation context', () => {
    const operations: Operation[] = [
      {
        abortController: new AbortController(),
        context: { agentId: 'agent-1', threadId: null, topicId: 'topic-1' },
        id: 'op-1',
        metadata: { startTime: Date.now() },
        status: 'running',
        type: 'contextCompression',
      },
      {
        abortController: new AbortController(),
        context: { agentId: 'agent-1', threadId: null, topicId: 'topic-2' },
        id: 'op-2',
        metadata: { startTime: Date.now() },
        status: 'running',
        type: 'generateSummary',
      },
    ];

    expect(
      hasRunningCompressionOperation(operations, {
        agentId: 'agent-1',
        groupId: undefined,
        threadId: null,
        topicId: 'topic-1',
      }),
    ).toBe(true);
    expect(
      hasRunningCompressionOperation(operations, {
        agentId: 'agent-1',
        groupId: undefined,
        threadId: null,
        topicId: 'topic-3',
      }),
    ).toBe(false);
  });

  it('should build a pending compressedGroup message', () => {
    const message = createPendingCompressedGroup({
      agentId: 'agent-1',
      groupId: 'group-1',
      id: 'temp-group-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    expect(message.role).toBe('compressedGroup');
    expect(message.id).toBe('temp-group-1');
    expect(message.metadata).toEqual({ expanded: true });
    expect(message.compressedMessages).toEqual([]);
  });
});

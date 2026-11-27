import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messagePlugins, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AttributionError, digest, MAX_TRACE_BYTES, trajectorySchema } from './contracts';
import type { TraceNode, Trajectory } from './contracts';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function argumentsText(value: unknown): string | null {
  return value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
}
function source(value: unknown): TraceNode['toolSource'] {
  return value === 'builtin' || value === 'mcp' || value === 'plugin' ? value : 'unknown';
}
function role(value: string): TraceNode['role'] {
  if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system')
    return value;
  if (value === 'function') return 'tool';
  if (value === 'developer') return 'system';
  throw new AttributionError(
    'unsupported_role',
    'The persisted trajectory contains an unsupported message role',
  );
}

/** Extract persisted rows with explicit ownership and exact thread boundaries, never an LLM summary. */
export async function extractTrajectory(
  db: LobeChatDatabase,
  userId: string,
  request: { runId: string; caseId: string; threadId?: string | null },
): Promise<Trajectory> {
  const run = await new AgentEvalRunModel(db, userId).findById(request.runId);
  if (!run) throw new AttributionError('not_found', 'Evaluation run not found');
  const item = await new AgentEvalRunTopicModel(db, userId).findByRunAndTestCase(
    request.runId,
    request.caseId,
  );
  if (
    !item ||
    !item.testCase ||
    item.testCase.userId !== userId ||
    item.testCase.datasetId !== run.datasetId ||
    item.topic?.userId !== userId
  ) {
    throw new AttributionError('not_found', 'Case is not an owned trajectory of this run');
  }
  const threadId = request.threadId ?? null;
  if ((run.config?.k ?? 1) > 1 && !threadId)
    throw new AttributionError(
      'thread_required',
      'A k>1 run must be diagnosed one evaluation thread at a time',
    );
  const thread = threadId ? await new ThreadModel(db, userId).findById(threadId) : undefined;
  if (threadId && (!thread || thread.topicId !== item.topicId || thread.type !== 'eval')) {
    throw new AttributionError(
      'not_found',
      'Thread is not an owned evaluation trajectory of this case',
    );
  }
  const metadata = thread ? object(thread.metadata) : object(item.evalResult);
  const status = thread
    ? (text(metadata.status) ?? (metadata.passed === false ? 'failed' : ''))
    : (item.status ?? '');
  if (!['failed', 'error', 'timeout'].includes(status))
    throw new AttributionError(
      'not_failed',
      'Only terminal failed, error or timed-out trajectories can be diagnosed',
    );
  const conditions = [
    eq(messages.userId, userId),
    eq(messages.topicId, item.topicId),
    threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
  ];
  const rows = await db
    .select({ message: messages, plugin: messagePlugins })
    .from(messages)
    .leftJoin(
      messagePlugins,
      and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(501);
  if (rows.length > 500)
    throw new AttributionError(
      'trace_too_large',
      'Trajectory exceeds 500 source rows; no truncated diagnosis was produced',
    );
  const nodes: TraceNode[] = [];
  const warnings = new Set<string>([
    'operation_events_unavailable',
    'provider_request_payload_unavailable',
  ]);
  const callNodes = new Map<string, TraceNode[]>();
  for (const { message, plugin } of rows) {
    const error = plugin?.error ?? message.error ?? null;
    const node: TraceNode = {
      id: `message:${message.id}`,
      messageId: message.id,
      parentId: message.parentId ? `message:${message.parentId}` : null,
      role: role(message.role),
      content: message.content ?? '',
      sourcePointer: `messages/${message.id}`,
      errorSourcePointer:
        plugin?.error != null
          ? `message_plugins/${message.id}/error`
          : message.error != null
            ? `messages/${message.id}/error`
            : null,
      toolCallId: text(plugin?.toolCallId),
      toolSource: 'unknown',
      toolName:
        plugin?.identifier && plugin.apiName ? `${plugin.identifier}____${plugin.apiName}` : null,
      arguments: text(plugin?.arguments),
      error,
      traceId: text(message.traceId),
      sequence: nodes.length,
      createdAt: message.createdAt?.toISOString() ?? null,
    };
    nodes.push(node);
    if (node.role !== message.role) warnings.add('legacy_role_normalized');
    if (node.role === 'assistant' && message.tools != null && !Array.isArray(message.tools)) {
      warnings.add('malformed_persisted_tool_calls');
    }
    if (node.role === 'assistant' && Array.isArray(message.tools)) {
      for (const [index, raw] of message.tools.entries()) {
        const tool = object(raw);
        const declaredSource = source(tool.source);
        const persistedType = source(tool.type);
        const conflictingSource =
          declaredSource !== 'unknown' &&
          persistedType !== 'unknown' &&
          declaredSource !== persistedType;
        if (conflictingSource) warnings.add('conflicting_tool_source');
        const name =
          text(tool.identifier) && text(tool.apiName)
            ? `${tool.identifier}____${tool.apiName}`
            : text(object(tool.function).name);
        const call: TraceNode = {
          ...node,
          id: `call:${message.id}:${index}`,
          parentId: node.id,
          role: 'call',
          content: '',
          sourcePointer: `messages/${message.id}/tools/${index}`,
          errorSourcePointer: null,
          error: null,
          toolCallId: text(tool.id),
          toolName: name,
          arguments: argumentsText(tool.arguments ?? object(tool.function).arguments),
          toolSource: conflictingSource
            ? 'unknown'
            : declaredSource !== 'unknown'
              ? declaredSource
              : persistedType,
          sequence: nodes.length,
        };
        nodes.push(call);
        if (call.toolSource === 'unknown') warnings.add('unknown_tool_source');
        if (call.toolCallId)
          callNodes.set(call.toolCallId, [...(callNodes.get(call.toolCallId) ?? []), call]);
        else warnings.add('missing_tool_call_id');
      }
    }
  }
  for (const node of nodes) {
    if (node.role !== 'tool') continue;
    const calls = node.toolCallId ? (callNodes.get(node.toolCallId) ?? []) : [];
    if (calls.length !== 1 || calls[0].sequence >= node.sequence) {
      warnings.add('missing_or_ambiguous_tool_call');
      continue;
    }
    const call = calls[0];
    if (node.toolName && call.toolName && node.toolName !== call.toolName) {
      warnings.add('conflicting_tool_identity');
      continue;
    }
    node.toolSource = call.toolSource;
    node.toolName = call.toolName;
    // The result keeps its own persisted arguments where available; otherwise references its exact paired call.
    node.arguments ??= call.arguments;
    if (node.toolSource === 'unknown') warnings.add('unknown_tool_source');
  }
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes)
    if (node.parentId && !ids.has(node.parentId)) warnings.add('dangling_parent');
  const traceIds = [
    ...new Set(nodes.map((node) => node.traceId).filter((id): id is string => id !== null)),
  ].sort();
  if (traceIds.length === 0) warnings.add('trace_id_unavailable');
  const operationId = text(metadata.operationId);
  if (!operationId) warnings.add('operation_id_unavailable');
  const dataset = await new AgentEvalDatasetModel(db, userId).findById(run.datasetId);
  const config = object(item.testCase.evalConfig ?? dataset?.evalConfig);
  const score = typeof metadata.score === 'number' ? metadata.score : item.score;
  const input = {
    schemaVersion: 1 as const,
    trajectoryId: `eval:${run.id}:${request.caseId}:${item.topicId}:${threadId ?? 'main'}`,
    inputDigest: 'pending',
    scope: {
      runId: run.id,
      caseId: request.caseId,
      topicId: item.topicId,
      threadId,
      operationId,
      traceIds,
    },
    nodes,
    evaluation: {
      status,
      score:
        typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1
          ? score
          : null,
      task: item.testCase.content.input,
      expected: item.testCase.content.expected ?? null,
      actual:
        [...nodes].reverse().find((node) => node.role === 'assistant' && node.content)?.content ??
        null,
      criteria: text(config.criteria) ?? text(config.judgePrompt),
    },
    coverage: {
      source: 'database_messages' as const,
      complete: warnings.size === 0,
      warnings: [...warnings].sort(),
    },
  };
  input.inputDigest = digest({ ...input, inputDigest: undefined });
  if (nodes.length > 500)
    throw new AttributionError(
      'trace_too_large',
      'Trajectory exceeds 500 evidence nodes; no truncated diagnosis was produced',
    );
  const validated = trajectorySchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > MAX_TRACE_BYTES) {
    throw new AttributionError(
      'trace_too_large',
      'Trajectory exceeds the 1 MiB contract; no truncated diagnosis was produced',
    );
  }
  return validated;
}

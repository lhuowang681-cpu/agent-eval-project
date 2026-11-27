import { digest } from '../contracts';
import type { Diagnostic, TraceNode, Trajectory } from '../contracts';

export function trajectoryFixture(): Trajectory {
  const base: TraceNode = {
    id: 'message:assistant',
    messageId: 'assistant',
    parentId: null,
    role: 'assistant',
    content: '',
    sourcePointer: 'messages/assistant',
    errorSourcePointer: null,
    toolCallId: null,
    toolSource: 'unknown',
    toolName: null,
    arguments: null,
    error: null,
    traceId: 'trace-source',
    sequence: 0,
    createdAt: '2026-11-08T00:00:00Z',
  };
  const input: Trajectory = {
    schemaVersion: 1,
    trajectoryId: 'eval:run:case:topic:main',
    inputDigest: 'pending',
    scope: {
      runId: 'run',
      caseId: 'case',
      topicId: 'topic',
      threadId: null,
      operationId: 'operation',
      traceIds: ['trace-source'],
    },
    evaluation: {
      status: 'failed',
      score: 0,
      task: 'Check order',
      expected: 'ok',
      actual: 'Unable',
      criteria: null,
    },
    coverage: { source: 'database_messages', complete: true, warnings: [] },
    nodes: [
      base,
      {
        ...base,
        id: 'call:assistant:0',
        parentId: base.id,
        role: 'call',
        sourcePointer: 'messages/assistant/tools/0',
        toolCallId: 'call-order',
        toolSource: 'mcp',
        toolName: 'orders____lookup',
        arguments: '{"id":1}',
        sequence: 1,
      },
      {
        ...base,
        id: 'message:result',
        messageId: 'result',
        parentId: base.id,
        role: 'tool',
        sourcePointer: 'messages/result',
        toolCallId: 'call-order',
        toolSource: 'mcp',
        toolName: 'orders____lookup',
        arguments: '{"id":1}',
        content: '{"success":false,"message":"service unavailable"}',
        sequence: 2,
      },
    ],
  };
  input.inputDigest = digest({ ...input, inputDigest: undefined });
  return input;
}

export function diagnosticFixture(input: Trajectory): Diagnostic {
  return {
    schemaVersion: 1,
    trajectoryId: input.trajectoryId,
    inputDigest: input.inputDigest,
    scope: input.scope,
    jobExecution: { status: 'completed', errors: [] },
    diagnosis: {
      status: 'unknown',
      category: null,
      moduleId: null,
      claimLevel: 'observation',
      summary: 'No established root cause',
      evidenceRefs: [],
      reasonCodes: ['insufficient_evidence'],
    },
    observations: [],
    coverage: input.coverage,
    provenance: { rulesVersion: 'test', sourceSha256: 'a'.repeat(64) },
  };
}

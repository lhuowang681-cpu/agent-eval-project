// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import {
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  messagePlugins,
  messages,
  threads,
  topics,
  users,
} from '@/database/schemas';
import {
  cleanupDB,
  serverDB,
  setupMultiCaseRun,
  userId,
} from '@/server/services/agentEvalRun/__tests__/_setup';

import { MAX_TRACE_BYTES } from '../contracts';
import { extractTrajectory } from '../trace';

let sequence = 0;
beforeEach(async () => {
  await cleanupDB();
  sequence = 0;
});

async function failedCases(count = 1) {
  const chain = await setupMultiCaseRun(Array.from({ length: count }, () => ({ expected: '42' })));
  const links = new AgentEvalRunTopicModel(serverDB, userId);
  for (const item of chain.cases)
    await links.updateByRunAndTopic(chain.run.id, item.topic.id, {
      status: 'failed',
      passed: false,
      score: 0,
      evalResult: { operationId: `op-${item.testCase.id}`, rubricScores: [] },
    });
  return chain;
}
async function message(
  topicId: string,
  fields: Omit<typeof messages.$inferInsert, 'topicId' | 'userId'>,
) {
  const [row] = await serverDB
    .insert(messages)
    .values({
      ...fields,
      topicId,
      userId,
      createdAt: new Date(1700000000000 + sequence++ * 1000),
    })
    .returning();
  return row;
}
async function toolPair(topicId: string, source: string, label: string, threadId?: string) {
  const call = await message(topicId, {
    role: 'assistant',
    threadId,
    traceId: `trace-${label}`,
    tools: [
      {
        id: 'shared-call-id',
        identifier: 'same-tool',
        apiName: 'run',
        source,
        arguments: { label },
      },
    ],
  });
  const result = await message(topicId, {
    role: 'tool',
    threadId,
    parentId: call.id,
    content: `result-${label}`,
    traceId: `trace-${label}`,
  });
  await serverDB.insert(messagePlugins).values({
    id: result.id,
    userId,
    toolCallId: 'shared-call-id',
    identifier: 'same-tool',
    apiName: 'run',
  });
  return { call, result };
}
async function state() {
  return Promise.all([
    serverDB.select().from(agentEvalRuns),
    serverDB.select().from(agentEvalRunTopics),
    serverDB.select().from(agentEvalDatasets),
    serverDB.select().from(agentEvalTestCases),
    serverDB.select().from(topics),
    serverDB.select().from(threads),
    serverDB.select().from(messages),
    serverDB.select().from(messagePlugins),
  ]);
}

describe('persisted evaluation trajectory extraction', () => {
  it('uses the real persisted tool type when source is absent and preserves the paired error evidence', async () => {
    const { run, cases } = await failedCases();
    const call = await message(cases[0].topic.id, {
      role: 'assistant',
      tools: [
        {
          id: 'persisted-calculator-call',
          type: 'builtin',
          identifier: 'lobe-calculator',
          apiName: 'calculate',
          arguments: '{"expression":"invalid("}',
        },
      ],
    });
    const result = await message(cases[0].topic.id, {
      role: 'tool',
      parentId: call.id,
      content: 'Calculation error',
    });
    await serverDB
      .insert(messagePlugins)
      .values({
        id: result.id,
        userId,
        toolCallId: 'persisted-calculator-call',
        identifier: 'lobe-calculator',
        apiName: 'calculate',
        error: { type: 'CalculationError', message: 'Invalid expression' },
      });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.nodes.find((node) => node.role === 'call')).toMatchObject({
      toolSource: 'builtin',
      sourcePointer: `messages/${call.id}/tools/0`,
    });
    expect(selected.nodes.find((node) => node.role === 'tool')).toMatchObject({
      toolSource: 'builtin',
      error: { type: 'CalculationError', message: 'Invalid expression' },
      errorSourcePointer: `message_plugins/${result.id}/error`,
    });
    expect(selected.coverage.warnings).not.toContain('unknown_tool_source');
  });

  it('does not infer builtin source from a recognized calculator name without persisted type/source', async () => {
    const { run, cases } = await failedCases();
    await message(cases[0].topic.id, {
      role: 'assistant',
      tools: [{ id: 'call-without-source', identifier: 'lobe-calculator', apiName: 'calculate' }],
    });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.nodes.find((node) => node.role === 'call')?.toolSource).toBe('unknown');
    expect(selected.coverage.warnings).toContain('unknown_tool_source');
  });

  it('does not silently choose a source when persisted source and type conflict', async () => {
    const { run, cases } = await failedCases();
    await message(cases[0].topic.id, {
      role: 'assistant',
      tools: [
        {
          id: 'conflicting-source-call',
          source: 'mcp',
          type: 'builtin',
          identifier: 'lobe-calculator',
          apiName: 'calculate',
        },
      ],
    });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.nodes.find((node) => node.role === 'call')?.toolSource).toBe('unknown');
    expect(selected.coverage.warnings).toContain('conflicting_tool_source');
  });

  it('is read-only, deterministic, and preserves exact tool/parent/trace/operation provenance', async () => {
    const { run, cases } = await failedCases();
    const item = cases[0];
    const { call, result } = await toolPair(item.topic.id, 'mcp', 'first');
    await serverDB
      .update(messagePlugins)
      .set({ error: { message: 'upstream 500' } })
      .where(eq(messagePlugins.id, result.id));
    const before = await state();
    const request = { runId: run.id, caseId: item.testCase.id };
    const extracted = await extractTrajectory(serverDB, userId, request);
    expect(extracted.scope).toMatchObject({
      ...request,
      topicId: item.topic.id,
      operationId: `op-${item.testCase.id}`,
      traceIds: ['trace-first'],
      threadId: null,
    });
    expect(extracted.nodes.find((node) => node.role === 'call')).toMatchObject({
      id: `call:${call.id}:0`,
      parentId: `message:${call.id}`,
      toolSource: 'mcp',
      sourcePointer: `messages/${call.id}/tools/0`,
      toolCallId: 'shared-call-id',
      arguments: '{"label":"first"}',
    });
    expect(extracted.nodes.find((node) => node.messageId === result.id)).toMatchObject({
      parentId: `message:${call.id}`,
      toolSource: 'mcp',
      toolName: 'same-tool____run',
      error: { message: 'upstream 500' },
      errorSourcePointer: `message_plugins/${result.id}/error`,
    });
    expect(await extractTrajectory(serverDB, userId, request)).toEqual(extracted);
    expect(await state()).toEqual(before);
  });

  it('does not correlate identical tool call ids across cases', async () => {
    const { run, cases } = await failedCases(2);
    await toolPair(cases[0].topic.id, 'builtin', 'case-a');
    await toolPair(cases[1].topic.id, 'plugin', 'case-b');
    const a = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    const b = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[1].testCase.id,
    });
    expect(a.nodes.find((node) => node.role === 'tool')?.toolSource).toBe('builtin');
    expect(b.nodes.find((node) => node.role === 'tool')?.toolSource).toBe('plugin');
    expect(a.nodes.some((node) => node.content === 'result-case-b')).toBe(false);
    expect(a.trajectoryId).not.toBe(b.trajectoryId);
  });

  it('rejects other users, unrelated cases, and unrelated or foreign threads', async () => {
    const { run, cases, benchmark } = await failedCases(2);
    const [otherDataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: benchmark.id,
        identifier: 'another-owned-dataset',
        name: 'Another',
        userId,
      })
      .returning();
    const [outOfRunCase] = await serverDB
      .insert(agentEvalTestCases)
      .values({
        datasetId: otherDataset.id,
        content: { input: 'Other task', expected: 'Other answer' },
        userId,
      })
      .returning();
    await serverDB.insert(users).values({ id: 'foreign-trace-user' });
    const own = new ThreadModel(serverDB, userId);
    const otherCase = await own.create({ topicId: cases[1].topic.id, type: 'eval' });
    const foreign = await new ThreadModel(serverDB, 'foreign-trace-user').create({
      topicId: cases[0].topic.id,
      type: 'eval',
    });
    const request = { runId: run.id, caseId: cases[0].testCase.id };
    await expect(extractTrajectory(serverDB, 'foreign-trace-user', request)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      extractTrajectory(serverDB, userId, { ...request, caseId: 'unrelated-case' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      extractTrajectory(serverDB, userId, { ...request, caseId: outOfRunCase.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      extractTrajectory(serverDB, userId, { ...request, threadId: otherCase.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      extractTrajectory(serverDB, userId, { ...request, threadId: foreign.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('requires an explicit k>1 thread and never merges sibling or main-topic messages', async () => {
    const { run, cases } = await failedCases();
    await new AgentEvalRunModel(serverDB, userId).update(run.id, { config: { k: 2 } });
    const model = new ThreadModel(serverDB, userId);
    const first = await model.create({ topicId: cases[0].topic.id, type: 'eval' });
    const second = await model.create({ topicId: cases[0].topic.id, type: 'eval' });
    for (const thread of [first, second])
      await model.update(thread.id, { metadata: { status: 'failed', passed: false, score: 0 } });
    await toolPair(cases[0].topic.id, 'builtin', 'thread-a', first.id);
    await toolPair(cases[0].topic.id, 'mcp', 'thread-b', second.id);
    await message(cases[0].topic.id, { role: 'assistant', content: 'main-topic-secret' });
    const request = { runId: run.id, caseId: cases[0].testCase.id };
    await expect(extractTrajectory(serverDB, userId, request)).rejects.toMatchObject({
      code: 'thread_required',
    });
    const selected = await extractTrajectory(serverDB, userId, { ...request, threadId: first.id });
    expect(selected.scope.threadId).toBe(first.id);
    expect(selected.nodes.find((node) => node.role === 'tool')?.toolSource).toBe('builtin');
    expect(selected.nodes.some((node) => /thread-b|main-topic-secret/.test(node.content))).toBe(
      false,
    );
    const main = await new ThreadModel(serverDB, userId).create({
      topicId: cases[0].topic.id,
      type: 'standalone',
    });
    await expect(
      extractTrajectory(serverDB, userId, { ...request, threadId: main.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('ignores foreign-owned messages and plugin metadata even if linked to this topic/message', async () => {
    const { run, cases } = await failedCases();
    await serverDB.insert(users).values({ id: 'foreign-trace-user' });
    await serverDB.insert(messages).values({
      role: 'assistant',
      content: 'foreign-message-secret',
      userId: 'foreign-trace-user',
      topicId: cases[0].topic.id,
    });
    const ownTool = await message(cases[0].topic.id, { role: 'tool', content: 'own-result' });
    await serverDB.insert(messagePlugins).values({
      id: ownTool.id,
      userId: 'foreign-trace-user',
      arguments: 'foreign-arguments-secret',
      error: { message: 'foreign-error-secret' },
      toolCallId: 'foreign-call',
    });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(JSON.stringify(selected)).not.toContain('foreign-');
    expect(selected.nodes.find((node) => node.messageId === ownTool.id)).toMatchObject({
      arguments: null,
      error: null,
      toolCallId: null,
    });
  });

  it('marks orphan tool results and unknown sources as incomplete instead of guessing from tool names', async () => {
    const { run, cases } = await failedCases();
    await message(cases[0].topic.id, { role: 'tool', content: 'orphan' });
    await toolPair(cases[0].topic.id, 'unrecorded-source', 'unknown');
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.coverage.complete).toBe(false);
    expect(selected.coverage.warnings).toEqual(
      expect.arrayContaining(['missing_or_ambiguous_tool_call', 'unknown_tool_source']),
    );
    expect(
      selected.nodes
        .filter((node) => node.role === 'tool')
        .every((node) => node.toolSource === 'unknown'),
    ).toBe(true);
  });

  it('does not turn error keywords in system instructions into failure events', async () => {
    const { run, cases } = await failedCases();
    await message(cases[0].topic.id, {
      role: 'system',
      content: 'Discuss error 500, timeout, PermissionError and tool failure as examples.',
    });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.nodes).toHaveLength(1);
    expect(selected.nodes[0]).toMatchObject({
      role: 'system',
      error: null,
      errorSourcePointer: null,
    });
  });

  it('warns about an unknown call source even when no tool result was persisted', async () => {
    const { run, cases } = await failedCases();
    await message(cases[0].topic.id, {
      role: 'assistant',
      tools: [{ id: 'unfinished-call', identifier: 'not-evidence-of-source', apiName: 'run' }],
    });
    const selected = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(selected.nodes.find((node) => node.role === 'call')?.toolSource).toBe('unknown');
    expect(selected.coverage.warnings).toContain('unknown_tool_source');
  });

  it('rejects a non-failed trajectory rather than treating instructions as a failure', async () => {
    const { run, cases } = await failedCases();
    await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(
      run.id,
      cases[0].topic.id,
      { status: 'passed', passed: true, score: 1 },
    );
    await expect(
      extractTrajectory(serverDB, userId, { runId: run.id, caseId: cases[0].testCase.id }),
    ).rejects.toMatchObject({ code: 'not_failed' });
  });

  it('rejects over 500 persisted rows without silently truncating the source', async () => {
    const { run, cases } = await failedCases();
    await serverDB.insert(messages).values(
      Array.from({ length: 500 }, (_, index) => ({
        role: 'user',
        userId,
        topicId: cases[0].topic.id,
        content: `row-${index}`,
      })),
    );
    const atLimit = await extractTrajectory(serverDB, userId, {
      runId: run.id,
      caseId: cases[0].testCase.id,
    });
    expect(atLimit.nodes).toHaveLength(500);
    await message(cases[0].topic.id, { role: 'user', content: 'row-501' });
    await expect(
      extractTrajectory(serverDB, userId, { runId: run.id, caseId: cases[0].testCase.id }),
    ).rejects.toMatchObject({ code: 'trace_too_large' });
    expect(await serverDB.select().from(messages)).toHaveLength(501);
  });

  it('rejects more than 500 expanded call nodes without returning a partial trace', async () => {
    const { run, cases } = await failedCases();
    await serverDB.insert(messages).values(
      Array.from({ length: 251 }, (_, index) => ({
        role: 'assistant',
        userId,
        topicId: cases[0].topic.id,
        tools: [{ id: `one-${index}` }, { id: `two-${index}` }],
      })),
    );
    await expect(
      extractTrajectory(serverDB, userId, { runId: run.id, caseId: cases[0].testCase.id }),
    ).rejects.toMatchObject({ code: 'trace_too_large' });
    expect(await serverDB.select().from(messages)).toHaveLength(251);
  });

  it('rejects an oversized serialized trace without changing or truncating the stored content', async () => {
    const { run, cases } = await failedCases();
    const content = 'x'.repeat(MAX_TRACE_BYTES);
    await message(cases[0].topic.id, { role: 'assistant', content });
    await expect(
      extractTrajectory(serverDB, userId, { runId: run.id, caseId: cases[0].testCase.id }),
    ).rejects.toMatchObject({ code: 'trace_too_large' });
    expect((await serverDB.select().from(messages))[0].content).toBe(content);
  });
});

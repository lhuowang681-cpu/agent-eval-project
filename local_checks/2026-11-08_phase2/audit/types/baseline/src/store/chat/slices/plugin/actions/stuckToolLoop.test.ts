import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { countTrailingIdenticalToolFailures, STUCK_TOOL_FAILURE_LIMIT } from './stuckToolLoop';

const assistantToolCall = (apiName: string): UIChatMessage =>
  ({
    id: `a-${Math.random()}`,
    role: 'assistant',
    content: '',
    plugin: { apiName, identifier: 'builtin-feishu-mcp', arguments: '{}', type: 'mcp' },
  }) as unknown as UIChatMessage;

// Mirrors the real Feishu failure: transport call succeeds but the result body is an error payload,
// so pluginError is null and the error lives only in `content`.
const feishuErrorResult = (apiName: string): UIChatMessage =>
  ({
    id: `t-${Math.random()}`,
    role: 'tool',
    content: '{"error":"[VALIDATION:1002] Markdown content cannot be empty"}',
    plugin: { apiName, identifier: 'builtin-feishu-mcp', arguments: '{}', type: 'mcp' },
  }) as unknown as UIChatMessage;

const okResult = (apiName: string): UIChatMessage =>
  ({
    id: `t-${Math.random()}`,
    role: 'tool',
    content: '{"message":"文档更新成功（append模式）"}',
    plugin: { apiName, identifier: 'builtin-feishu-mcp', arguments: '{}', type: 'mcp' },
  }) as unknown as UIChatMessage;

// Build the realistic interleaving: assistant(tool call) -> tool(error) repeated.
const buildLoop = (apiName: string, times: number): UIChatMessage[] =>
  Array.from({ length: times }).flatMap(() => [
    assistantToolCall(apiName),
    feishuErrorResult(apiName),
  ]);

describe('countTrailingIdenticalToolFailures', () => {
  it('counts consecutive identical error-body tool results (no pluginError set)', () => {
    const { count, toolName } = countTrailingIdenticalToolFailures(buildLoop('update-doc', 4));

    expect(count).toBe(4);
    expect(toolName).toBe('update-doc');
    expect(count).toBeGreaterThanOrEqual(STUCK_TOOL_FAILURE_LIMIT);
  });

  it('counts structured pluginError failures too', () => {
    const withPluginError = {
      id: 't1',
      role: 'tool',
      content: '',
      pluginError: { message: 'boom' },
      plugin: { apiName: 'run', identifier: 'p', arguments: '{}', type: 'default' },
    } as unknown as UIChatMessage;

    const { count } = countTrailingIdenticalToolFailures([
      withPluginError,
      withPluginError,
      withPluginError,
    ]);

    expect(count).toBe(3);
  });

  it('does not trigger when the latest tool result succeeded', () => {
    const messages = [
      ...buildLoop('update-doc', 5),
      assistantToolCall('update-doc'),
      okResult('update-doc'),
    ];

    expect(countTrailingIdenticalToolFailures(messages).count).toBe(0);
  });

  it('resets the streak when a different error breaks the run', () => {
    const messages = [
      assistantToolCall('update-doc'),
      okResult('update-doc'), // success in the middle
      assistantToolCall('update-doc'),
      feishuErrorResult('update-doc'),
      assistantToolCall('update-doc'),
      feishuErrorResult('update-doc'),
    ];

    // only the trailing two identical failures count, below the limit
    expect(countTrailingIdenticalToolFailures(messages).count).toBe(2);
  });

  it('does not conflate failures from different tools', () => {
    const messages = [
      assistantToolCall('create-doc'),
      feishuErrorResult('create-doc'),
      assistantToolCall('update-doc'),
      feishuErrorResult('update-doc'),
    ];

    // trailing run is a single update-doc failure; create-doc has a different signature
    expect(countTrailingIdenticalToolFailures(messages).count).toBe(1);
  });

  it('still counts when only the error text varies but the call is identical', () => {
    const erroredWithLogId = (logId: string): UIChatMessage =>
      ({
        id: `t-${logId}`,
        role: 'tool',
        content: `{"error":"[SERVER:500] internal error","log_id":"${logId}"}`,
        plugin: {
          apiName: 'update-doc',
          identifier: 'builtin-feishu-mcp',
          arguments: '{"doc_id":"D","mode":"append"}',
          type: 'mcp',
        },
      }) as unknown as UIChatMessage;

    const messages = [erroredWithLogId('a'), erroredWithLogId('b'), erroredWithLogId('c')];

    expect(countTrailingIdenticalToolFailures(messages).count).toBe(3);
  });

  it('resets the streak when the call arguments change', () => {
    const erroredWithArgs = (args: string): UIChatMessage =>
      ({
        id: `t-${args}`,
        role: 'tool',
        content: '{"error":"boom"}',
        plugin: {
          apiName: 'update-doc',
          identifier: 'builtin-feishu-mcp',
          arguments: args,
          type: 'mcp',
        },
      }) as unknown as UIChatMessage;

    // model keeps trying *different* inputs — not a stuck loop, only the last one counts
    const messages = [
      erroredWithArgs('{"x":1}'),
      erroredWithArgs('{"x":2}'),
      erroredWithArgs('{"x":3}'),
    ];

    expect(countTrailingIdenticalToolFailures(messages).count).toBe(1);
  });

  it('returns 0 when there are no tool messages', () => {
    expect(countTrailingIdenticalToolFailures([]).count).toBe(0);
  });

  it('does not count a user-cancelled call as a failure, and it bounds the streak', () => {
    const cancelledResult = (apiName: string): UIChatMessage =>
      ({
        id: `t-${Math.random()}`,
        role: 'tool',
        content: 'Tool execution was cancelled by user.',
        pluginError: { message: 'boom' }, // stale error left over from the in-flight call
        pluginIntervention: { status: 'aborted' },
        plugin: { apiName, identifier: 'lobe-local-system', arguments: '{}', type: 'builtin' },
      }) as unknown as UIChatMessage;

    const messages = [
      assistantToolCall('runCommand'),
      feishuErrorResult('runCommand'), // real failure #1
      assistantToolCall('runCommand'),
      cancelledResult('runCommand'), // user cancel — not a failure, bounds the scan
      assistantToolCall('runCommand'),
      feishuErrorResult('runCommand'), // real failure #2
    ];

    // the cancelled call isn't counted, and it stops the scan from reaching failure #1
    expect(countTrailingIdenticalToolFailures(messages).count).toBe(1);
  });

  it('stops the scan at the last stuckToolLoopBreak checkpoint', () => {
    const breakerMessage: UIChatMessage = {
      id: 'break-1',
      role: 'assistant',
      content: 'stopped',
      metadata: { stuckToolLoopBreak: true },
    } as unknown as UIChatMessage;

    const messages = [
      ...buildLoop('update-doc', 3), // an earlier streak that already tripped the breaker once
      breakerMessage,
      assistantToolCall('update-doc'),
      feishuErrorResult('update-doc'), // a fresh, independent retry after the checkpoint
    ];

    // only the failure after the checkpoint counts — the earlier streak was already reported
    expect(countTrailingIdenticalToolFailures(messages).count).toBe(1);
  });
});

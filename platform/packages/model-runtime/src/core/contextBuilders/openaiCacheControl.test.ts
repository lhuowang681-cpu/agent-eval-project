import { describe, expect, it } from 'vitest';

import { injectOpenAICacheControl } from './openaiCacheControl';

describe('injectOpenAICacheControl', () => {
  it('should inject cache_control into string system prompt', () => {
    const payload: any = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      stream: true,
      system: 'You are a helpful assistant',
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.system).toEqual([
      { type: 'text', text: 'You are a helpful assistant', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('should inject cache_control into last block of array system prompt', () => {
    const payload: any = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      stream: true,
      system: [
        { type: 'text', text: 'System part 1' },
        { type: 'text', text: 'System part 2' },
      ],
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.system).toEqual([
      { type: 'text', text: 'System part 1' },
      { type: 'text', text: 'System part 2', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('should inject cache_control into string content of last message', () => {
    const payload: any = {
      messages: [
        { content: 'Hello', role: 'user' },
        { content: 'How can I help?', role: 'assistant' },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    // 倒数第二条 user 也会被打上历史稳定前缀断点
    expect(result.messages).toEqual([
      {
        content: [{ type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } }],
        role: 'user',
      },
      {
        content: [{ type: 'text', text: 'How can I help?', cache_control: { type: 'ephemeral' } }],
        role: 'assistant',
      },
    ]);
  });

  it('should inject cache_control into last block of array content of last message', () => {
    const payload: any = {
      messages: [
        { content: 'Hello', role: 'user' },
        {
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
          role: 'assistant',
        },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.messages).toEqual([
      {
        content: [{ type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } }],
        role: 'user',
      },
      {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2', cache_control: { type: 'ephemeral' } },
        ],
        role: 'assistant',
      },
    ]);
  });

  it('should skip thinking blocks when injecting into array content', () => {
    const payload: any = {
      messages: [
        {
          content: [
            { type: 'text', text: 'Normal text' },
            { type: 'thinking', thinking: 'Some thinking', signature: 'sig' },
          ],
          role: 'assistant',
        },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.messages).toEqual([
      {
        content: [
          { type: 'text', text: 'Normal text', cache_control: { type: 'ephemeral' } },
          { type: 'thinking', thinking: 'Some thinking', signature: 'sig' },
        ],
        role: 'assistant',
      },
    ]);
  });

  it('should inject cache_control into last tool definition', () => {
    const payload: any = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      stream: true,
      tools: [
        {
          function: { name: 'tool1', parameters: { type: 'object' } },
          type: 'function',
        },
        {
          function: { name: 'tool2', parameters: { type: 'object' } },
          type: 'function',
        },
      ],
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.tools).toEqual([
      {
        function: { name: 'tool1', parameters: { type: 'object' } },
        type: 'function',
      },
      {
        function: { name: 'tool2', parameters: { type: 'object' } },
        type: 'function',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('should mutate payload in place', () => {
    const payload: any = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      stream: true,
    };

    const returned = injectOpenAICacheControl(payload);

    expect(returned).toBe(payload);
    expect(payload.messages[0].content).toEqual([
      { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('should handle payload without system, tools, or messages gracefully', () => {
    const payload: any = {
      messages: [],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.messages).toEqual([]);
    expect(result.system).toBeUndefined();
    expect(result.tools).toBeUndefined();
  });

  it('should not add a historical-prefix breakpoint for a single-user-message payload', () => {
    const payload: any = {
      messages: [{ content: 'Only turn', role: 'user' }],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    // 只有一条 user 消息 —— 只打一个断点(当前轮末尾),不产生历史前缀断点
    expect(result.messages).toEqual([
      {
        content: [{ type: 'text', text: 'Only turn', cache_control: { type: 'ephemeral' } }],
        role: 'user',
      },
    ]);
  });

  it('should place historical-prefix breakpoint on the nearest earlier user message, skipping assistant/tool', () => {
    const payload: any = {
      messages: [
        { content: 'first user', role: 'user' },
        { content: 'first assistant reply', role: 'assistant' },
        { content: 'second user', role: 'user' },
        {
          content: [{ tool_call_id: 'call_1', type: 'tool_result', content: 'tool output' }],
          role: 'tool',
        },
        { content: 'assistant follow-up', role: 'assistant' },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    // 历史稳定前缀断点应落在最近的、非末尾的 user 消息(即 'second user')上
    expect(result.messages[0]).toEqual({ content: 'first user', role: 'user' });
    expect(result.messages[1]).toEqual({ content: 'first assistant reply', role: 'assistant' });
    expect(result.messages[2]).toEqual({
      content: [{ type: 'text', text: 'second user', cache_control: { type: 'ephemeral' } }],
      role: 'user',
    });
    // tool 消息不应被打断点
    expect(result.messages[3].content[0]).not.toHaveProperty('cache_control');
    // 最后一条消息(assistant follow-up)会被打上当前轮末尾断点
    expect(result.messages[4]).toEqual({
      content: [
        { type: 'text', text: 'assistant follow-up', cache_control: { type: 'ephemeral' } },
      ],
      role: 'assistant',
    });
  });

  it('should place all four breakpoints when system, tools, and multi-turn history are present', () => {
    const payload: any = {
      messages: [
        { content: 'turn 1', role: 'user' },
        { content: 'reply 1', role: 'assistant' },
        { content: 'turn 2', role: 'user' },
      ],
      model: 'claude-test',
      stream: true,
      system: 'system prompt',
      tools: [
        { function: { name: 'a', parameters: { type: 'object' } }, type: 'function' },
        { function: { name: 'b', parameters: { type: 'object' } }, type: 'function' },
      ],
    };

    const result = injectOpenAICacheControl(payload);

    // 收集所有断点位置的数量,验证不超过 4 个
    let count = 0;
    if ((result.system as any[])?.some((b: any) => b.cache_control)) count += 1;
    if (result.tools?.some((t: any) => t.cache_control)) count += 1;
    for (const msg of result.messages as any[]) {
      const content = msg.content;
      if (Array.isArray(content) && content.some((b: any) => b?.cache_control)) count += 1;
    }
    expect(count).toBe(4);

    // 具体位置校验
    expect((result.system as any[]).at(-1)).toEqual({
      type: 'text',
      text: 'system prompt',
      cache_control: { type: 'ephemeral' },
    });
    expect(result.tools.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(result.messages[0]).toEqual({
      content: [{ type: 'text', text: 'turn 1', cache_control: { type: 'ephemeral' } }],
      role: 'user',
    });
    // 中间 assistant 不应有断点
    expect(result.messages[1]).toEqual({ content: 'reply 1', role: 'assistant' });
    expect(result.messages[2]).toEqual({
      content: [{ type: 'text', text: 'turn 2', cache_control: { type: 'ephemeral' } }],
      role: 'user',
    });
  });

  it('should skip thinking/redacted_thinking blocks when marking historical user message', () => {
    const payload: any = {
      messages: [
        {
          content: [
            { type: 'text', text: 'earlier user text' },
            { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
          ],
          role: 'user',
        },
        { content: 'assistant reply', role: 'assistant' },
        { content: 'latest user text', role: 'user' },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    // 历史 user 的 thinking 块要跳过,断点打在 text 上
    expect(result.messages[0]).toEqual({
      content: [
        { type: 'text', text: 'earlier user text', cache_control: { type: 'ephemeral' } },
        { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
      ],
      role: 'user',
    });
    expect(result.messages[2]).toEqual({
      content: [{ type: 'text', text: 'latest user text', cache_control: { type: 'ephemeral' } }],
      role: 'user',
    });
  });
});

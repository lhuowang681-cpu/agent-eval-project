// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAdaAI, params } from './index';

testProvider({
  Runtime: LobeAdaAI,
  provider: ModelProvider.Ada,
  defaultBaseURL: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  chatDebugEnv: 'DEBUG_ADA_CHAT_COMPLETION',
  chatModel: 'claude-sonnet-4-6',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeAdaAI - params', () => {
  it('should have correct provider', () => {
    expect(params.provider).toBe(ModelProvider.Ada);
  });

  it('should have handlePayload that adds ada- prefix', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    expect(handlePayload).toBeDefined();

    const result = handlePayload!(
      { model: 'claude-sonnet-4-6', messages: [], stream: true } as any,
      {} as any,
    );
    expect(result.model).toBe('ada-claude-sonnet-4-6');
  });

  it('should not add ada- prefix if already present', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    const result = handlePayload!(
      { model: 'ada-claude-sonnet-4-6', messages: [], stream: true } as any,
      {} as any,
    );
    expect(result.model).toBe('ada-claude-sonnet-4-6');
  });

  it('should strip trailing assistant prefill (ada 网关不支持 assistant 结尾)', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'partial', role: 'assistant' },
    ];

    const result = handlePayload!(
      { model: 'claude-opus-4-7', messages, stream: true } as any,
      {} as any,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages.at(-1).role).toBe('user');
  });

  it('should strip consecutive trailing assistant messages', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'a1', role: 'assistant' },
      { content: 'a2', role: 'assistant' },
    ];

    const result = handlePayload!(
      { model: 'claude-sonnet-4-6', messages, stream: true } as any,
      {} as any,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages.at(-1).role).toBe('user');
  });

  it('should keep messages ending with user/tool unchanged', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'tool result', role: 'tool', tool_call_id: 't1' },
    ];

    const result = handlePayload!(
      { model: 'claude-opus-4-7', messages, stream: true } as any,
      {} as any,
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages.at(-1).role).toBe('tool');
  });

  it('should NOT strip trailing assistant for non-Claude models (可能支持 prefill)', () => {
    const handlePayload = params.chatCompletion?.handlePayload;
    const messages = [
      { content: 'hi', role: 'user' },
      { content: 'partial', role: 'assistant' },
    ];

    const result = handlePayload!({ model: 'gpt-4o', messages, stream: true } as any, {} as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages.at(-1).role).toBe('assistant');
  });
});

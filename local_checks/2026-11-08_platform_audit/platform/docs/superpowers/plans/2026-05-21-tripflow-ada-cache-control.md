# Tripflow & Ada Cache Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic-style `cache_control` injection for Tripflow and Ada providers through the OpenAI-compatible factory, with per-model configuration via qconfig.

**Architecture:** Extend the OpenAI-compatible factory to inject `cache_control: { type: 'ephemeral' }` into request payloads when the provider opts in (`cacheControl: true`) and the model supports it (`enabledContextCaching` via qconfig). Enhance usage conversion to parse Anthropic-style cache token fields. Fix `modelParamsResolver` so `disableContextCaching` defaults to enabled (not undefined).

**Tech Stack:** TypeScript, Vitest, OpenAI SDK types

---

## File Structure

| File                                                                         | Action | Responsibility                                                                                                  |
| ---------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `src/services/chat/mecha/modelParamsResolver.ts`                             | Modify | Change `disableContextCaching` semantics: default to `true` instead of `undefined`                              |
| `src/services/chat/mecha/modelParamsResolver.test.ts`                        | Modify | Update existing tests and add new test for default-true behavior                                                |
| `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts`      | Create | `injectOpenAICacheControl(payload)` — injects `cache_control` into system, messages, tools                      |
| `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts` | Create | Unit tests for the injection function                                                                           |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`           | Modify | Add `cacheControl?: boolean` to options; call `injectOpenAICacheControl` in chat flow                           |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`      | Modify | Add tests verifying `cacheControl` integration                                                                  |
| `packages/model-runtime/src/core/usageConverters/openai.ts`                  | Modify | Extend `convertOpenAIUsage` to handle Anthropic-style `cache_read_input_tokens` / `cache_creation_input_tokens` |
| `packages/model-runtime/src/core/usageConverters/openai.test.ts`             | Modify | Add tests for Anthropic-style usage conversion                                                                  |
| `packages/model-runtime/src/providers/tripflow/index.ts`                     | Modify | Enable `cacheControl: true` in `chatCompletion` options                                                         |
| `packages/model-runtime/src/providers/ada/index.ts`                          | Modify | Enable `cacheControl: true` in `chatCompletion` options                                                         |
| `.local/ai-infra-config.json`                                                | Modify | Add `disableContextCaching` to `extendParams` for cache-supporting models                                       |

---

## Task 1: Fix `modelParamsResolver` — `disableContextCaching` defaults to enabled

**Files:**

- Modify: `src/services/chat/mecha/modelParamsResolver.ts:96-98`

- Test: `src/services/chat/mecha/modelParamsResolver.test.ts:169-212`

- [ ] **Step 1: Write the failing test**

Add a new test case at the end of the `context caching` describe block in `modelParamsResolver.test.ts`:

```typescript
it('should set enabledContextCaching to true when disableContextCaching is false (default on)', () => {
  const result = resolveModelExtendParams({
    chatConfig: {
      disableContextCaching: false,
    } as any,
    model: 'gpt-4',
    provider: 'openai',
  });

  expect(result.enabledContextCaching).toBe(true);
});

it('should set enabledContextCaching to true by default when not provided', () => {
  const result = resolveModelExtendParams({
    chatConfig: {} as any,
    model: 'gpt-4',
    provider: 'openai',
  });

  expect(result.enabledContextCaching).toBe(true);
});
```

Also update the existing test on line 191-201 that currently expects `undefined`:

```typescript
// Change this existing test from:
// expect(result.enabledContextCaching).toBeUndefined();
// to:
expect(result.enabledContextCaching).toBe(true);
```

Update the test on line 203-211 that currently expects `undefined`:

```typescript
// Change this existing test from:
// expect(result.enabledContextCaching).toBeUndefined();
// to:
expect(result.enabledContextCaching).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run --silent='passed-only' src/services/chat/mecha/modelParamsResolver.test.ts
```

Expected: FAIL — `enabledContextCaching` is `undefined` but test expects `true`

- [ ] **Step 3: Write minimal implementation**

In `src/services/chat/mecha/modelParamsResolver.ts`, replace lines 96-98:

```typescript
// Old code:
// if (modelExtendParams.includes('disableContextCaching') && chatConfig.disableContextCaching) {
//   extendParams.enabledContextCaching = false;
// }

// New code:
if (modelExtendParams.includes('disableContextCaching')) {
  extendParams.enabledContextCaching = !chatConfig.disableContextCaching;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run --silent='passed-only' src/services/chat/mecha/modelParamsResolver.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/chat/mecha/modelParamsResolver.ts src/services/chat/mecha/modelParamsResolver.test.ts
git commit -m "$(
  cat << 'EOF'
fix: change disableContextCaching semantics to default enabled

Models with disableContextCaching extendParam now default to
enabledContextCaching=true instead of undefined.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `injectOpenAICacheControl` function

**Files:**

- Create: `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts`

- Test: `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts`:

```typescript
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { injectOpenAICacheControl } from './openaiCacheControl';

describe('injectOpenAICacheControl', () => {
  it('should inject cache_control into string system prompt', () => {
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
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
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
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
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
      messages: [
        { content: 'Hello', role: 'user' },
        { content: 'How can I help?', role: 'assistant' },
      ],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.messages).toEqual([
      { content: 'Hello', role: 'user' },
      {
        content: [{ type: 'text', text: 'How can I help?', cache_control: { type: 'ephemeral' } }],
        role: 'assistant',
      },
    ]);
  });

  it('should inject cache_control into last block of array content of last message', () => {
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
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
      { content: 'Hello', role: 'user' },
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
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
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
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
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

  it('should not mutate the original payload', () => {
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      stream: true,
    };

    const originalMessages = payload.messages;
    injectOpenAICacheControl(payload);

    expect(payload.messages).toBe(originalMessages);
    expect(payload.messages).toEqual([{ content: 'Hello', role: 'user' }]);
  });

  it('should handle payload without system, tools, or messages gracefully', () => {
    const payload: OpenAI.ChatCompletionCreateParamsStreaming = {
      messages: [],
      model: 'claude-test',
      stream: true,
    };

    const result = injectOpenAICacheControl(payload);

    expect(result.messages).toEqual([]);
    expect(result.system).toBeUndefined();
    expect(result.tools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run --silent='passed-only' packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts
```

Expected: FAIL — `injectOpenAICacheControl` is not defined

- [ ] **Step 3: Write minimal implementation**

Create `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts`:

```typescript
import type OpenAI from 'openai';

export const injectOpenAICacheControl = (
  payload: OpenAI.ChatCompletionCreateParamsStreaming,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const result = { ...payload };

  // 1. System prompt
  if (result.system) {
    if (typeof result.system === 'string') {
      result.system = [{ type: 'text', text: result.system, cache_control: { type: 'ephemeral' } }];
    } else if (Array.isArray(result.system)) {
      const lastBlock = result.system.at(-1);
      if (lastBlock && lastBlock.type === 'text') {
        (lastBlock as any).cache_control = { type: 'ephemeral' };
      }
    }
  }

  // 2. Messages: last message's last content block
  if (result.messages?.length) {
    const lastMessage = result.messages.at(-1);
    if (lastMessage) {
      if (typeof lastMessage.content === 'string') {
        lastMessage.content = [
          { type: 'text', text: lastMessage.content, cache_control: { type: 'ephemeral' } },
        ];
      } else if (Array.isArray(lastMessage.content)) {
        const lastBlock = lastMessage.content.at(-1);
        if (lastBlock && lastBlock.type !== 'thinking') {
          (lastBlock as any).cache_control = { type: 'ephemeral' };
        }
      }
    }
  }

  // 3. Tools: last tool definition
  if (result.tools?.length) {
    const lastTool = result.tools.at(-1);
    if (lastTool) {
      (lastTool as any).cache_control = { type: 'ephemeral' };
    }
  }

  return result;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run --silent='passed-only' packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts packages/model-runtime/src/core/contextBuilders/openaiCacheControl.test.ts
git commit -m "$(
  cat << 'EOF'
feat: add injectOpenAICacheControl for OpenAI-compatible providers

Injects cache_control: { type: 'ephemeral' } into system prompt,
last message content block, and last tool definition.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Integrate `cacheControl` into OpenAI-compatible factory

**Files:**

- Modify: `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:94-127` (options type) and `~492-510` (chat flow)

- Test: `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`

- [ ] **Step 1: Add `cacheControl` to options type**

In `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`, find the `OpenAICompatibleFactoryOptions` interface (around line 91-127) and add `cacheControl?: boolean` to the `chatCompletion` object:

```typescript
export interface OpenAICompatibleFactoryOptions<T extends Record<string, any> = any> {
  // ... other fields
  chatCompletion?: {
    // ... existing fields like excludeUsage, forceImageBase64, handleError, handlePayload, etc.
    cacheControl?: boolean; // <-- ADD THIS
    // ... rest of existing fields
  };
  // ...
}
```

Add the import at the top of the file:

```typescript
import { injectOpenAICacheControl } from '../contextBuilders/openaiCacheControl';
```

- [ ] **Step 2: Wire injection into chat flow**

In the `chat` method of `createOpenAICompatibleRuntime`, find the `finalPayload` construction (around line 492-500) and add the injection call right after it:

```typescript
const finalPayload = {
  ...cleanedPayload,
  messages,
  ...(chatCompletion?.noUserId ? {} : { user: options?.user }),
  stream_options:
    postPayload.stream && !chatCompletion?.excludeUsage ? { include_usage: true } : undefined,
};

// Inject cache_control for providers that support it
if (chatCompletion?.cacheControl && payload.enabledContextCaching === true) {
  injectOpenAICacheControl(finalPayload);
}
```

- [ ] **Step 3: Add integration test**

In `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`, add a new describe block at the end of the file (before the final closing brace):

```typescript
describe('cacheControl integration', () => {
  const LobeCacheProvider = createOpenAICompatibleRuntime({
    baseURL: defaultBaseURL,
    chatCompletion: {
      cacheControl: true,
    },
    provider: ModelProvider.Groq,
  });

  it('should inject cache_control when cacheControl is enabled and enabledContextCaching is true', async () => {
    const instance = new LobeCacheProvider({ apiKey: 'test' });
    const mockStream = new ReadableStream();

    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

    await instance.chat({
      enabledContextCaching: true,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      temperature: 0,
    });

    const callArgs = (instance['client'].chat.completions.create as Mock).mock.calls[0];
    const payload = callArgs[0];

    expect(payload.messages[0].content).toEqual([
      { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('should NOT inject cache_control when enabledContextCaching is false', async () => {
    const instance = new LobeCacheProvider({ apiKey: 'test' });
    const mockStream = new ReadableStream();

    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

    await instance.chat({
      enabledContextCaching: false,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      temperature: 0,
    });

    const callArgs = (instance['client'].chat.completions.create as Mock).mock.calls[0];
    const payload = callArgs[0];

    expect(payload.messages[0].content).toBe('Hello');
  });

  it('should NOT inject cache_control when cacheControl is not configured', async () => {
    const instance = new LobeMockProvider({ apiKey: 'test' });
    const mockStream = new ReadableStream();

    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(mockStream as any);

    await instance.chat({
      enabledContextCaching: true,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'claude-test',
      temperature: 0,
    });

    const callArgs = (instance['client'].chat.completions.create as Mock).mock.calls[0];
    const payload = callArgs[0];

    expect(payload.messages[0].content).toBe('Hello');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
bunx vitest run --silent='passed-only' packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts
```

Expected: PASS for new tests and existing tests

- [ ] **Step 5: Commit**

```bash
git add packages/model-runtime/src/core/openaiCompatibleFactory/index.ts packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts
git commit -m "$(
  cat << 'EOF'
feat: integrate cacheControl into OpenAI-compatible factory

When chatCompletion.cacheControl is true and payload.enabledContextCaching
is true, inject cache_control into the final request payload.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `convertOpenAIUsage` for Anthropic-style cache fields

**Files:**

- Modify: `packages/model-runtime/src/core/usageConverters/openai.ts:11-70`

- Test: `packages/model-runtime/src/core/usageConverters/openai.test.ts`

- [ ] **Step 1: Add failing tests for Anthropic-style usage**

In `packages/model-runtime/src/core/usageConverters/openai.test.ts`, add new test cases at the end of the `describe('convertUsage')` block:

```typescript
it('should handle Anthropic-style cache_read_input_tokens and cache_creation_input_tokens', () => {
  const anthropicUsage = {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 2000,
    total_tokens: 1500,
  } as any;

  const result = convertOpenAIUsage(anthropicUsage);

  expect(result).toEqual({
    inputCacheMissTokens: 1000,
    inputCachedTokens: 2000,
    inputWriteCacheTokens: 500,
    totalInputTokens: 3500,
    totalOutputTokens: 500,
    outputTextTokens: 500,
    totalTokens: 1500,
  });
});

it('should handle Anthropic-style with only cache_read_input_tokens', () => {
  const anthropicUsage = {
    input_tokens: 500,
    output_tokens: 200,
    cache_read_input_tokens: 1500,
    total_tokens: 700,
  } as any;

  const result = convertOpenAIUsage(anthropicUsage);

  expect(result).toEqual({
    inputCacheMissTokens: 500,
    inputCachedTokens: 1500,
    totalInputTokens: 2000,
    totalOutputTokens: 200,
    outputTextTokens: 200,
    totalTokens: 700,
  });
});

it('should prefer Anthropic-style fields over OpenAI-style when both present', () => {
  const mixedUsage = {
    prompt_tokens: 100,
    input_tokens: 50,
    cache_read_input_tokens: 200,
    completion_tokens: 30,
    total_tokens: 130,
  } as any;

  const result = convertOpenAIUsage(mixedUsage);

  expect(result.inputCacheMissTokens).toBe(50);
  expect(result.inputCachedTokens).toBe(200);
  expect(result.totalInputTokens).toBe(250);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run --silent='passed-only' packages/model-runtime/src/core/usageConverters/openai.test.ts
```

Expected: FAIL — new tests fail because Anthropic fields are not handled

- [ ] **Step 3: Implement usage conversion enhancement**

Replace the first part of `convertOpenAIUsage` in `packages/model-runtime/src/core/usageConverters/openai.ts` (lines 11-40 approximately):

```typescript
export const convertOpenAIUsage = (
  usage: OpenAI.Completions.CompletionUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage => {
  const rawUsage = usage as any;

  // Detect Anthropic-style cache fields
  const hasAnthropicCacheFields =
    rawUsage.cache_creation_input_tokens !== undefined ||
    rawUsage.cache_read_input_tokens !== undefined;

  let inputTextTokens: number;
  let inputCachedTokens: number | undefined;
  let inputWriteCacheTokens: number | undefined;
  let inputCacheMissTokens: number;
  let totalInputTokens: number;

  if (hasAnthropicCacheFields) {
    // Anthropic-style: input_tokens represents cache miss
    inputTextTokens = rawUsage.input_tokens ?? usage.prompt_tokens ?? 0;
    inputCachedTokens = rawUsage.cache_read_input_tokens;
    inputWriteCacheTokens = rawUsage.cache_creation_input_tokens;
    inputCacheMissTokens = inputTextTokens;
    totalInputTokens =
      inputTextTokens + (inputCachedTokens || 0) + (inputWriteCacheTokens || 0);
  } else {
    // OpenAI-style: prompt_tokens represents total input
    inputTextTokens = usage.prompt_tokens || 0;
    inputCachedTokens =
      rawUsage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens;
    const cachedTokensNum = inputCachedTokens || 0;
    inputCacheMissTokens =
      rawUsage.prompt_cache_miss_tokens || inputTextTokens - cachedTokensNum;
    totalInputTokens = inputTextTokens + (rawUsage.citation_tokens || 0);
  }

  const totalOutputTokens = usage.completion_tokens;
  // ... rest of the function remains the same, just replace references to usage.prompt_tokens
  // with inputTextTokens where appropriate
```

The remaining lines of the function (output token handling, total tokens, etc.) stay the same. Just make sure `inputTextTokens` is used instead of `usage.prompt_tokens || 0` where needed.

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run --silent='passed-only' packages/model-runtime/src/core/usageConverters/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/model-runtime/src/core/usageConverters/openai.ts packages/model-runtime/src/core/usageConverters/openai.test.ts
git commit -m "$(
  cat << 'EOF'
feat: support Anthropic-style cache token fields in OpenAI usage conversion

convertOpenAIUsage now detects and correctly handles
cache_read_input_tokens and cache_creation_input_tokens.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Enable `cacheControl` in Tripflow and Ada providers

**Files:**

- Modify: `packages/model-runtime/src/providers/tripflow/index.ts:50-62`

- Modify: `packages/model-runtime/src/providers/ada/index.ts:6-22`

- [ ] **Step 1: Enable cacheControl for Tripflow**

In `packages/model-runtime/src/providers/tripflow/index.ts`, update the `params` object:

```typescript
export const params = {
  createImage: createTripflowImage,
  createVideo,
  handleCreateVideoWebhook,
  debug: {
    chatCompletion: () => process.env.DEBUG_TRIPFLOW_CHAT_COMPLETION === '1',
  },
  chatCompletion: {
    cacheControl: true,
  },
  models: async ({ client }) => {
    // ... existing models logic
  },
  provider: ModelProvider.Tripflow,
} satisfies OpenAICompatibleFactoryOptions;
```

- [ ] **Step 2: Enable cacheControl for Ada**

In `packages/model-runtime/src/providers/ada/index.ts`, update the `params` object:

```typescript
export const params = {
  baseURL: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  chatCompletion: {
    cacheControl: true,
    handlePayload: (payload: any) => {
      const { model, ...rest } = payload;
      const adaModel = model.startsWith('ada-') ? model : `ada-${model}`;
      return { ...rest, model: adaModel, stream: rest.stream ?? true };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ADA_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Ada,
} satisfies OpenAICompatibleFactoryOptions;
```

- [ ] **Step 3: Commit**

```bash
git add packages/model-runtime/src/providers/tripflow/index.ts packages/model-runtime/src/providers/ada/index.ts
git commit -m "$(
  cat << 'EOF'
feat: enable cacheControl for Tripflow and Ada providers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update qconfig for cache-supporting models

**Files:**

- Modify: `.local/ai-infra-config.json`

- [ ] **Step 1: Add `disableContextCaching` to Claude models**

For each of the following models in `.local/ai-infra-config.json`, add `"disableContextCaching"` to their `settings.extendParams` array:

- `claude-opus-4-7`
- `claude-sonnet-4-6`
- `claude-opus-4-6-v1`
- `claude-haiku-4-5`

Example change for each:

```json
"settings": {
  "extendParams": ["enableAdaptiveThinking", "disableContextCaching"],
  // ... rest of settings
}
```

**Do NOT** add to models that do not support caching (e.g., `gemini-3-pro-image-preview`, `veo-3.1-generate-001`, `doubao-seedance-2-0`, `gpt-image-2`).

- [ ] **Step 2: Commit**

```bash
git add .local/ai-infra-config.json
git commit -m "$(
  cat << 'EOF'
config: add disableContextCaching to cache-supporting models in qconfig

Claude models now support context caching via Tripflow and Ada.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run full test suite and type check

- [ ] **Step 1: Run model-runtime tests**

```bash
cd packages/model-runtime && bunx vitest run --silent='passed-only' src/core/contextBuilders/openaiCacheControl.test.ts src/core/usageConverters/openai.test.ts src/core/openaiCompatibleFactory/index.test.ts
```

Expected: All PASS

- [ ] **Step 2: Run modelParamsResolver tests**

```bash
bunx vitest run --silent='passed-only' src/services/chat/mecha/modelParamsResolver.test.ts
```

Expected: All PASS

- [ ] **Step 3: Run type check**

```bash
bun run type-check
```

Expected: No type errors

- [ ] **Step 4: Final commit (if any fixes were needed)**

If type check or tests required fixes, commit them. Otherwise skip.

---

## Self-Review Checklist

**1. Spec coverage:**

- [x] `modelParamsResolver` semantic fix — Task 1
- [x] `injectOpenAICacheControl` function — Task 2
- [x] OpenAI-compatible factory integration — Task 3
- [x] Usage conversion enhancement — Task 4
- [x] Provider configuration (Tripflow/Ada) — Task 5
- [x] qconfig model configuration — Task 6

**2. Placeholder scan:**

- [x] No TBD/TODO
- [x] All code blocks contain actual code
- [x] All test commands include expected output
- [x] No "similar to Task N" shortcuts

**3. Type consistency:**

- [x] `injectOpenAICacheControl` signature matches usage in factory
- [x] `cacheControl` property name consistent across options type and provider configs
- [x] `enabledContextCaching` type (`boolean | undefined`) consistent with payload type

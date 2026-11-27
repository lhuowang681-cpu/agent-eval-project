# Tripflow & Ada Token Cache Control 设计方案

## 背景

Anthropic 的 Claude 模型支持 Prompt Caching，通过在请求中注入 `cache_control: { type: 'ephemeral' }` 来标记需要缓存的内容块（system prompt、最后一条消息的最后一个 content block、最后一个 tool definition）。响应中通过 `cache_read_input_tokens` 和 `cache_creation_input_tokens` 报告缓存命中和写入的 token 数量。

Tripflow 和 Ada 后端使用 OpenAI 兼容的 API 格式，但底层支持 Anthropic 式的 `cache_control` 扩展字段。需要为这两个 provider 添加和 Anthropic 一致的 token 缓存逻辑，并支持在 qconfig（`ai-infra-config.json`）中按模型配置是否启用。

## 设计目标

1. 请求层面：在 OpenAI 兼容格式的请求中按 Anthropic 规则注入 `cache_control`
2. 响应层面：正确解析 Anthropic 格式的缓存 token usage 字段
3. 配置层面：通过 qconfig 按模型粒度控制是否启用缓存
4. 安全层面：不影响其他不使用该功能的 OpenAI 兼容 provider

## 架构设计

### 1. modelParamsResolver 语义修正

当前 `modelParamsResolver` 对 `disableContextCaching` 的处理逻辑是：只有用户显式关闭时才设置 `enabledContextCaching = false`，否则为 `undefined`。

修改为：只要模型拥有 `disableContextCaching` extendParam，就默认认为支持缓存（`enabledContextCaching = true`），用户关闭后才设为 `false`。

```typescript
// src/services/chat/mecha/modelParamsResolver.ts
if (modelExtendParams.includes('disableContextCaching')) {
  extendParams.enabledContextCaching = !chatConfig.disableContextCaching;
}
```

**影响面分析：**

- Anthropic/Bedrock 工厂在 provider 层面默认 `enabledContextCaching = true`，不读取 payload，不受影响
- OpenAI 官方 / Azure 等 provider 的模型当前没有 `disableContextCaching`，不受影响
- OpenRouter / Vercel AI Gateway 的 Claude 模型已动态添加 `disableContextCaching`，若未来开启 `cacheControl` 可直接生效

### 2. OpenAI 兼容工厂扩展

#### 2.1 类型扩展

在 `OpenAICompatibleFactoryOptions.chatCompletion` 中新增 `cacheControl?: boolean`：

```typescript
export interface OpenAICompatibleFactoryOptions {
  chatCompletion?: {
    // ... existing fields
    cacheControl?: boolean;
  };
}
```

#### 2.2 Cache Control 注入函数

新建 `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts`，实现 `injectOpenAICacheControl`：

```typescript
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

  // 2. Messages: 最后一条消息的最后一个 content block
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

  // 3. Tools: 最后一个 tool definition
  if (result.tools?.length) {
    const lastTool = result.tools.at(-1);
    if (lastTool) {
      (lastTool as any).cache_control = { type: 'ephemeral' };
    }
  }

  return result;
};
```

注入规则与 Anthropic 工厂保持一致：

- System prompt：最后一个 text block 添加 `cache_control`
- Messages：最后一条消息的最后一个非 - thinking content block 添加 `cache_control`
- Tools：最后一个 tool definition 添加 `cache_control`

#### 2.3 工厂集成点

在 `openaiCompatibleFactory/index.ts` 的 `chat` 方法中，构建 `finalPayload` 之后、`chat.completions.create` 调用之前：

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

**集成位置说明：** 注入发生在 `convertOpenAIMessages` 处理之后、`chat.completions.create` 之前，确保修改的是最终发送给后端的 payload。

### 3. Usage 转换增强

在 `packages/model-runtime/src/core/usageConverters/openai.ts` 的 `convertOpenAIUsage` 中，扩展对 Anthropic 格式 usage 的支持：

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
    // Anthropic-style: input_tokens = cache miss
    inputTextTokens = rawUsage.input_tokens ?? usage.prompt_tokens ?? 0;
    inputCachedTokens = rawUsage.cache_read_input_tokens;
    inputWriteCacheTokens = rawUsage.cache_creation_input_tokens;
    inputCacheMissTokens = inputTextTokens;
    totalInputTokens = inputTextTokens + (inputCachedTokens || 0) + (inputWriteCacheTokens || 0);
  } else {
    // OpenAI-style: prompt_tokens = total input
    inputTextTokens = usage.prompt_tokens || 0;
    inputCachedTokens =
      rawUsage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens;
    const cachedTokensNum = inputCachedTokens || 0;
    inputCacheMissTokens = rawUsage.prompt_cache_miss_tokens || inputTextTokens - cachedTokensNum;
    totalInputTokens = inputTextTokens + (rawUsage.citation_tokens || 0);
  }

  // ... rest of the function uses these values
};
```

### 4. Provider 配置

#### Tripflow

```typescript
export const params = {
  // ... existing fields
  chatCompletion: {
    cacheControl: true,
  },
  provider: ModelProvider.Tripflow,
} satisfies OpenAICompatibleFactoryOptions;
```

#### Ada

```typescript
export const params = {
  // ... existing fields
  chatCompletion: {
    cacheControl: true,
    handlePayload: (payload: any) => {
      // ... existing logic
    },
  },
  provider: ModelProvider.Ada,
} satisfies OpenAICompatibleFactoryOptions;
```

### 5. qconfig 模型配置

在 `.local/ai-infra-config.json` 的 `modelRegistry` 中，为支持缓存的模型添加 `disableContextCaching` 到 `settings.extendParams`：

```json
{
  "modelRegistry": {
    "claude-opus-4-7": {
      "settings": {
        "extendParams": ["enableAdaptiveThinking", "disableContextCaching"]
      }
    },
    "claude-sonnet-4-6": {
      "settings": {
        "extendParams": ["enableAdaptiveThinking", "disableContextCaching"]
      }
    }
  }
}
```

不支持缓存的模型（如图像生成、视频生成模型）不添加 `disableContextCaching`。

## 数据流

```
qconfig (ai-infra-config.json)
  └── 模型 settings.extendParams 包含 disableContextCaching
        └── modelParamsResolver
              └── ChatStreamPayload.enabledContextCaching = true/false
                    └── OpenAI 兼容工厂
                          └── chatCompletion.cacheControl === true && enabledContextCaching === true
                                └── injectOpenAICacheControl(finalPayload)
                                      └── 后端 API
                                            └── 响应 usage (cache_read_input_tokens / cache_creation_input_tokens)
                                                  └── convertOpenAIUsage
                                                        └── ModelUsage (inputCachedTokens / inputWriteCacheTokens)
```

## 测试策略

1. **单元测试 - `injectOpenAICacheControl`**
   - system 为字符串时转换为数组并添加 cache_control
   - system 为数组时最后一个 block 添加 cache_control
   - messages 最后一条为字符串时转换并添加
   - messages 最后一条为数组时最后一个非 - thinking block 添加
   - tools 最后一个添加 cache_control

2. **单元测试 - `convertOpenAIUsage`**
   - Anthropic 格式 usage：正确计算 totalInputTokens、inputCacheMissTokens、inputCachedTokens、inputWriteCacheTokens
   - OpenAI 格式 usage：保持现有行为不变
   - 混合格式：优先 Anthropic 字段

3. **集成测试 - provider 配置**
   - Tripflow/Ada 配置中 `cacheControl: true` 正确传递

## 风险与回滚

| 风险                                                          | 缓解措施                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 向不支持 cache_control 的后端发送未知字段导致报错             | 只在 `chatCompletion.cacheControl === true` 且 `enabledContextCaching === true` 时注入；qconfig 中按需配置模型      |
| modelParamsResolver 修改影响其他 provider                     | 修改后 `enabledContextCaching` 为 `true` 的模型只在配置了 `cacheControl` 的 provider 中生效；其他 provider 不受影响 |
| OpenRouter/Vercel 已有 `disableContextCaching` 的模型行为变化 | 这些 provider 当前未配置 `cacheControl`，不受影响                                                                   |

## 文件变更清单

- `src/services/chat/mecha/modelParamsResolver.ts` — 修改 `disableContextCaching` 处理逻辑
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` — 集成 `injectOpenAICacheControl`
- `packages/model-runtime/src/core/contextBuilders/openaiCacheControl.ts` — 新增注入函数
- `packages/model-runtime/src/core/usageConverters/openai.ts` — 扩展 Anthropic 格式 usage 支持
- `packages/model-runtime/src/providers/tripflow/index.ts` — 启用 `cacheControl`
- `packages/model-runtime/src/providers/ada/index.ts` — 启用 `cacheControl`
- `.local/ai-infra-config.json` — 为支持缓存的模型添加 `disableContextCaching`

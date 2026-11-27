# Ada Coding Plan 自动接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通过 Ctrip SSO 登录的用户无需手动配置即可使用 Ada Coding Plan 模型

**Architecture:** 在服务端 initModelRuntimeFromDB 阶段通过 AdaTokenService 换取 Bearer token 并 patch payload，Ada runtime 从 Anthropic 协议切换到 OpenAI Chat Completions 协议（因为 OpenAI SDK 天然将 apiKey 转为 Authorization: Bearer 头），handlePayload 自动追加 ada- 模型前缀，前端隐藏 API Key 和 Endpoint 输入框

**Tech Stack:** TypeScript, OpenAI SDK, zustand, drizzle-orm, vitest

---

## File Structure

| File                                                     | Responsibility                                                   | Status |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| `src/envs/llm.ts`                                        | ADA_APP_ID 和 ADA_APP_SECRET 环境变量定义                        | Modify |
| `.env.example`                                           | 环境变量示例                                                     | Modify |
| `src/server/services/adaToken/index.ts`                  | Ada Token 换取服务（查 empcode + exchange + 缓存）               | Create |
| `src/server/services/adaToken/index.test.ts`             | AdaTokenService 测试                                             | Create |
| `src/server/modules/ModelRuntime/index.ts`               | initModelRuntimeFromDB 中 Ada patch                              | Modify |
| `packages/model-runtime/src/providers/ada/index.ts`      | 从 Anthropic 改为 OpenAI Compatible + handlePayload 加 ada- 前缀 | Modify |
| `packages/model-runtime/src/providers/ada/index.test.ts` | 更新 runtime 测试（defaultBaseURL 改变）                         | Modify |
| `packages/model-bank/src/modelProviders/ada.ts`          | sdkType='openai', showApiKey=false, 删除 proxyUrl                | Modify |
| `packages/database/src/repositories/aiInfra/index.ts`    | Ada provider 已配置状态注入                                      | Modify |

---

### Task 1: 新增环境变量

**Files:**

- Modify: `src/envs/llm.ts:217-230` (在 ENABLED_ZTRIP 区域之后)

- Modify: `.env.example`

- [ ] **Step 1: 在 `src/envs/llm.ts` server 节添加 ADA_APP_ID 和 ADA_APP_SECRET**

在 `server` 对象中 `ENABLED_ZTRIP` / `ZTRIP_API_KEY` 行之后添加：

```typescript
      ADA_APP_ID: z.string().optional(),
      ADA_APP_SECRET: z.string().optional(),
```

在 `runtimeEnv` 对象中对应位置添加：

```typescript
      ADA_APP_ID: process.env.ADA_APP_ID,
      ADA_APP_SECRET: process.env.ADA_APP_SECRET,
```

- [ ] **Step 2: 在 `.env.example` 添加注释示例**

在文件末尾（或 LLM 相关区域）添加：

```bash
# Ada Coding Plan Integration
# ADA_APP_ID=cpapp_xxx
# ADA_APP_SECRET=cpapp_sec_xxx
```

- [ ] **Step 3: 验证环境变量解析**

运行: `bun run type-check`
Expected: PASS（没有类型错误）

- [ ] **Step 4: Commit**

```bash
git add src/envs/llm.ts .env.example
git commit -m "feat: add ADA_APP_ID and ADA_APP_SECRET env variables"
```

---

### Task 2: 创建 AdaTokenService

**Files:**

- Create: `src/server/services/adaToken/index.ts`

- Create: `src/server/services/adaToken/index.test.ts`

- [ ] **Step 1: 写 AdaTokenService 测试文件**

创建 `src/server/services/adaToken/index.test.ts`：

```typescript
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdaTokenService,
  NoCodingPlanError,
  EmpcodeNotFoundError,
  AdaConfigMissingError,
} from './index';

// Mock environment variables via getLLMConfig
vi.mock('@/envs/llm', () => ({
  getLLMConfig: () => ({
    ADA_APP_ID: 'cpapp_test_id',
    ADA_APP_SECRET: 'cpapp_test_secret',
  }),
}));

// Mock database
const mockDb = {
  query: {
    users: {
      findFirst: vi.fn(),
    },
  },
};

describe('AdaTokenService', () => {
  let service: AdaTokenService;

  beforeEach(() => {
    service = new AdaTokenService(mockDb as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clear the internal cache between tests
    service.clearCache();
  });

  describe('exchangeToken', () => {
    it('should throw EmpcodeNotFoundError when user has no username', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: null });

      await expect(service.exchangeToken('user-1')).rejects.toThrow(EmpcodeNotFoundError);
    });

    it('should throw EmpcodeNotFoundError when user is not found', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(undefined);

      await expect(service.exchangeToken('user-1')).rejects.toThrow(EmpcodeNotFoundError);
    });

    it('should throw AdaConfigMissingError when ADA_APP_ID is not configured', async () => {
      vi.mock('@/envs/llm', () => ({
        getLLMConfig: () => ({
          ADA_APP_ID: undefined,
          ADA_APP_SECRET: undefined,
        }),
      }));
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      // Re-import module to pick up new mock
      const { AdaTokenService: FreshService } = await import('./index');
      const serviceNoEnv = new FreshService(mockDb as any);
      await expect(serviceNoEnv.exchangeToken('user-1')).rejects.toThrow(AdaConfigMissingError);

      // Restore original mock
      vi.restoreAllMocks();
    });

    it('should throw NoCodingPlanError when exchange returns success=false', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, message: '目标用户未生效 Coding Plan 套餐' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      await expect(service.exchangeToken('user-1')).rejects.toThrow(NoCodingPlanError);
      await expect(service.exchangeToken('user-1')).rejects.toHaveProperty(
        'message',
        '目标用户未生效 Coding Plan 套餐',
      );
    });

    it('should return token on successful exchange', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            token: 'test_token_123',
            expiresAt: Date.now() / 1000 + 86400,
            tokenId: 'tid_1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const token = await service.exchangeToken('user-1');
      expect(token).toBe('test_token_123');
    });

    it('should return cached token when not expired', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      const expiresAt = Date.now() / 1000 + 86400;
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            token: 'cached_token',
            expiresAt,
            tokenId: 'tid_2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // First call - should hit the API
      const token1 = await service.exchangeToken('user-2');
      expect(token1).toBe('cached_token');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const token2 = await service.exchangeToken('user-2');
      expect(token2).toBe('cached_token');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1); // No additional fetch call
    });

    it('should refresh token when cache is expired', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      // First response - token that expires soon
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            token: 'old_token',
            expiresAt: Date.now() / 1000 - 300, // Expired 5 minutes ago
            tokenId: 'tid_old',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // Second response - fresh token
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            token: 'new_token',
            expiresAt: Date.now() / 1000 + 86400,
            tokenId: 'tid_new',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // First call triggers exchange
      const token1 = await service.exchangeToken('user-3');
      expect(token1).toBe('old_token');

      // Second call - cache expired, triggers new exchange
      const token2 = await service.exchangeToken('user-3');
      expect(token2).toBe('new_token');
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate concurrent requests for the same user', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({ username: 'TR029591' });

      // Resolve the exchange immediately so both concurrent calls get the result
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            token: 'concurrent_token',
            expiresAt: Date.now() / 1000 + 86400,
            tokenId: 'tid_concurrent',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // Fire two concurrent requests
      const [result1, result2] = await Promise.all([
        service.exchangeToken('user-4'),
        service.exchangeToken('user-4'),
      ]);

      // Both should get the same token
      expect(result1).toBe('concurrent_token');
      expect(result2).toBe('concurrent_token');

      // Only one fetch call should have been made due to deduplication
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/adaToken/index.test.ts'`
Expected: FAIL - `Cannot find module '@/server/services/adaToken/index'`

- [ ] **Step 3: 写 AdaTokenService 实现**

创建 `src/server/services/adaToken/index.ts`：

```typescript
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getLLMConfig } from '@/envs/llm';

// ============ Error Types ============

export class EmpcodeNotFoundError extends Error {
  constructor(userId: string) {
    super(`Ada: empcode not found for user ${userId}`);
    this.name = 'EmpcodeNotFoundError';
  }
}

export class AdaConfigMissingError extends Error {
  constructor() {
    super('Ada: ADA_APP_ID or ADA_APP_SECRET not configured');
    this.name = 'AdaConfigMissingError';
  }
}

export class NoCodingPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoCodingPlanError';
  }
}

export class AdaGatewayError extends Error {
  constructor(status: number, body: string) {
    super(`Ada gateway error: ${status} ${body}`);
    this.name = 'AdaGatewayError';
  }
}

// ============ Cache Structures ============

interface TokenCacheValue {
  expiresAt: number; // Unix timestamp in seconds
  token: string;
}

const ADA_TOKEN_EXCHANGE_URL =
  'http://ada-cli-golang.ctripcorp.com/api/coding-plan/integration-apps/token/exchange';

const CACHE_EXPIRY_BUFFER_SECONDS = 300; // 5 minutes buffer

// Token cache: userId -> { token, expiresAt }
const tokenCache = new Map<string, TokenCacheValue>();

// Deduplication map: userId -> ongoing exchange Promise
const pendingExchanges = new Map<string, Promise<string>>();

// ============ Service ============

export class AdaTokenService {
  constructor(private db: LobeChatDatabase) {}

  async exchangeToken(userId: string): Promise<string> {
    // 1. Check cache
    const cached = tokenCache.get(userId);
    if (cached && cached.expiresAt > Date.now() / 1000 + CACHE_EXPIRY_BUFFER_SECONDS) {
      return cached.token;
    }

    // 2. Deduplication: if there's an ongoing exchange for this userId, wait for it
    const pending = pendingExchanges.get(userId);
    if (pending) {
      return pending;
    }

    // 3. Start a new exchange
    const exchangePromise = this._doExchange(userId);
    pendingExchanges.set(userId, exchangePromise);

    try {
      const token = await exchangePromise;
      return token;
    } finally {
      pendingExchanges.delete(userId);
    }
  }

  private async _doExchange(userId: string): Promise<string> {
    // 1. Get empcode from database
    const row = await this.db.query.users.findFirst({
      columns: { username: true },
      where: eq(users.id, userId),
    });
    const empcode = row?.username;
    if (!empcode || !empcode.trim()) {
      throw new EmpcodeNotFoundError(userId);
    }

    // 2. Check environment variables
    const llmConfig = getLLMConfig();
    const appId = llmConfig.ADA_APP_ID;
    const appSecret = llmConfig.ADA_APP_SECRET;
    if (!appId || !appSecret) {
      throw new AdaConfigMissingError();
    }

    // 3. Call Ada token exchange
    const res = await fetch(ADA_TOKEN_EXCHANGE_URL, {
      body: JSON.stringify({ appId, appSecret, empcode: empcode.trim() }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new AdaGatewayError(res.status, errorBody);
    }

    const data = (await res.json()) as {
      expiresAt?: number;
      message?: string;
      success?: boolean;
      token?: string;
    };

    // 4. Check success field
    if (data.success === false) {
      throw new NoCodingPlanError(data.message || '目标用户未生效 Coding Plan 套餐');
    }

    const token = data.token;
    if (!token) {
      throw new AdaGatewayError(200, 'Token not found in exchange response');
    }

    // 5. Cache the token
    const expiresAt = data.expiresAt || Date.now() / 1000 + 86400;
    tokenCache.set(userId, { expiresAt, token });

    return token;
  }

  /** Clear all cached tokens - used for testing and admin operations */
  clearCache(): void {
    tokenCache.clear();
    pendingExchanges.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/adaToken/index.test.ts'`
Expected: PASS - 所有测试用例通过

> 注意：并发去重测试中 `resolveExchange` 的时序可能需要调整。如果测试失败，需要确保 `resolveExchange` 在 `Promise.all` 之前被调用。具体修复方式取决于实际运行结果。

- [ ] **Step 5: Commit**

```bash
git add src/server/services/adaToken/index.ts src/server/services/adaToken/index.test.ts
git commit -m "feat: add AdaTokenService for token exchange and caching"
```

---

### Task 3: 在 initModelRuntimeFromDB 中添加 Ada Patch

**Files:**

- Modify: `src/server/modules/ModelRuntime/index.ts:429-438` (在 Ztrip patch 之后)

- [ ] **Step 1: 在 `initModelRuntimeFromDB` 中添加 Ada import 和 patch**

在文件顶部 import 区域添加：

```typescript
import { AdaTokenService } from '@/server/services/adaToken';
```

在 `initModelRuntimeFromDB` 函数中，Ztrip patch 逻辑（第 429-438 行）之后添加：

```typescript
if (runtimeProvider === ModelProvider.Ada) {
  const adaTokenService = new AdaTokenService(db);
  const adaToken = await adaTokenService.exchangeToken(userId);
  payload = {
    ...payload,
    apiKey: adaToken,
    baseURL: payload.baseURL || 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  };
}
```

- [ ] **Step 2: 验证类型检查**

Run: `bun run type-check`
Expected: PASS - 没有 TypeScript 类型错误

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/ModelRuntime/index.ts
git commit -m "feat: add Ada runtime patch in initModelRuntimeFromDB"
```

---

### Task 4: 改造 Ada Runtime 为 OpenAI Compatible

**Files:**

- Modify: `packages/model-runtime/src/providers/ada/index.ts` (完全重写)

- Modify: `packages/model-runtime/src/providers/ada/index.test.ts` (更新 defaultBaseURL)

- [ ] **Step 1: 重写 Ada Runtime 文件**

将 `packages/model-runtime/src/providers/ada/index.ts` 完整替换为：

```typescript
import { ModelProvider } from 'model-bank';

import {
  createOpenAICompatibleParams,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';

export const params = createOpenAICompatibleParams({
  baseURL: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, ...rest } = payload;
      // 追加 ada- 前缀（Ada 网关要求）
      const adaModel = model.startsWith('ada-') ? model : `ada-${model}`;
      return { ...rest, model: adaModel, stream: rest.stream ?? true };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ADA_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Ada,
});

export const LobeAdaAI = createOpenAICompatibleRuntime(params);

export default LobeAdaAI;
```

- [ ] **Step 2: 更新 Ada Runtime 测试**

将 `packages/model-runtime/src/providers/ada/index.test.ts` 更新：

```typescript
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
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `cd packages/model-runtime && bunx vitest run --silent='passed-only' 'src/providers/ada/index.test.ts'`
Expected: PASS - 所有测试通过

- [ ] **Step 4: 验证类型检查**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/model-runtime/src/providers/ada/index.ts packages/model-runtime/src/providers/ada/index.test.ts
git commit -m "feat: switch Ada runtime from Anthropic to OpenAI Compatible with ada- prefix handler"
```

---

### Task 5: 改造 Ada Provider Card 配置

**Files:**

- Modify: `packages/model-bank/src/modelProviders/ada.ts`

- [ ] **Step 1: 修改 Provider Card 配置**

将 `packages/model-bank/src/modelProviders/ada.ts` 中 `settings` 和 `proxyUrl` 修改：

1. 删除 `proxyUrl` 顶层字段（第 15-17 行的 `proxyUrl: { placeholder: '...' }`）
2. 删除 `settings.proxyUrl` 字段（第 22-26 行的整个 proxyUrl 对象）
3. 将 `settings.sdkType` 从 `'anthropic'` 改为 `'openai'`
4. 将 `settings.showApiKey` 从 `true` 改为 `false`

修改后的完整文件：

```typescript
import type { ModelProviderCard } from '@/types/llm';

const ADA_LOGO = 'https://dimg04.c-ctrip.com/images/1xt4u12000s5gb39t227A.png';

const AdaProvider: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-sonnet-4-6',
  description:
    'Coding Plan provides a unified gateway for curated chat models via Anthropic API. Configure your API base URL and API key.',
  enabled: true,
  id: 'ada',
  logo: ADA_LOGO,
  modelList: { showModelFetcher: false },
  name: 'Ada',
  settings: {
    defaultShowBrowserRequest: false,
    disableBrowserRequest: true,
    modelEditable: false,
    sdkType: 'openai',
    showAddNewModel: false,
    showApiKey: false,
    showChecker: true,
    showModelFetcher: false,
    modelListHeaderText: '启用模型前，请确认 Ada 平台已配置该模型',
  },
  url: '',
};

export default AdaProvider;
```

- [ ] **Step 2: 验证类型检查**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/model-bank/src/modelProviders/ada.ts
git commit -m "feat: hide API Key/Endpoint in Ada provider card, switch sdkType to openai"
```

---

### Task 6: Ada Provider 已配置状态注入

**Files:**

- Modify: `packages/database/src/repositories/aiInfra/index.ts`

- [ ] **Step 1: 在 AiInfraRepos 中为 Ada 注入已配置状态**

在 `getAiProviderRuntimeState` 方法中，找到合并 `providerConfigs` 和 `result` 的逻辑，添加对 Ada 的特殊处理。

具体位置：在 `Object.entries(result).forEach(...)` 循环之后，添加：

```typescript
// Ada SSO mode: if ADA_APP_ID is configured, inject sso-managed apiKey
// so frontend recognizes Ada as "configured" even without user keyVaults
const llmConfig = getLLMConfig();
if (llmConfig.ADA_APP_ID && runtimeConfig[ModelProvider.Ada]) {
  const adaConfig = runtimeConfig[ModelProvider.Ada];
  if (!adaConfig.keyVaults?.apiKey) {
    runtimeConfig[ModelProvider.Ada] = {
      ...adaConfig,
      keyVaults: {
        ...adaConfig.keyVaults,
        apiKey: 'sso-managed',
      },
    };
  }
}
```

需要在文件顶部添加 `getLLMConfig` import：

```typescript
import { getLLMConfig } from '@/envs/llm';
```

> 注意：`getLLMConfig` 来自 `@/envs/llm`，不在 aiInfra/index.ts 的现有 import 中。需要确认 packages/database 包是否能 import src/envs。如果不能，可能需要通过其他方式获取配置（如将 ADA_APP_ID 传入 AiInfraRepos 构造函数）。在实现时根据实际模块边界调整。

- [ ] **Step 2: 验证类型检查**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/repositories/aiInfra/index.ts
git commit -m "feat: inject sso-managed apiKey for Ada provider in runtime state"
```

---

### Task 7: Ada getParamsFromPayload 简化

**Files:**

- Modify: `src/server/modules/ModelRuntime/index.ts:170-172` (getParamsFromPayload 中的 Ada case)

- [ ] **Step 1: 简化 getParamsFromPayload 中的 Ada case**

当前代码（第 170-172 行）：

```typescript
    case ModelProvider.Ada: {
      return { apiKey: payload.apiKey, baseURL: payload.baseURL, ...payload };
    }
```

改为走 default case（因为 Ada 现在用 OpenAI SDK，不需要特殊处理）：

删除整个 `case ModelProvider.Ada` 分支。Ada 会落入 default case，default case 已经处理了 apiKey 和 baseURL。

- [ ] **Step 2: 验证类型检查**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/ModelRuntime/index.ts
git commit -m "refactor: remove Ada-specific getParamsFromPayload case, falls through to default"
```

---

### Task 8: 最终集成验证

**Files:** No new files

- [ ] **Step 1: 运行完整类型检查**

Run: `bun run type-check`
Expected: PASS - 全项目类型检查通过

- [ ] **Step 2: 运行 Ada 相关所有测试**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/adaToken/index.test.ts'`
Run: `cd packages/model-runtime && bunx vitest run --silent='passed-only' 'src/providers/ada/index.test.ts'`
Expected: PASS - 所有 Ada 相关测试通过

- [ ] **Step 3: 手动启动 SPA dev 环境验证前端效果**

Run: `bun run dev:spa`

打开浏览器验证：

1. 设置页面 Ada provider 不展示 API Key 和 Endpoint 输入框
2. Ada provider 显示为 "已配置" 状态
3. 连接检测按钮仍然可见

- [ ] **Step 4: 最终 Commit（如有小修）**

如果手动验证过程中有小修复，提交修复：

```bash
git add -A
git commit -m "fix: minor adjustments from manual verification"
```

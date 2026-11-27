# Ada Coding Plan 自动接入设计

## 需求回顾

- 用户通过 Ctrip SSO 登录后，直接使用自己的 Ada Coding Plan 模型，无需手动配置 endpoint 和 apikey
- 设置页面的 Ada 不展示 API Key 和 Endpoint，且不可修改
- appId 和 appSecret 放在环境变量里
- 通过工号 (empcode) 等信息换取 token，然后调用 Ada 的模型
- 如果用户没有生效的 Coding Plan 套餐，在设置页 Ada 页面提供跳转链接到激活页面

---

## 关键约束

1. **认证方式**：Ada 网关要求 `Authorization: Bearer <token>`，不支持 `x-api-key`
2. **模型前缀**：请求中 model 字段必须以 `ada-` 为前缀（如 `ada-claude-sonnet-4-20250514`）
3. **模型列表**：通过 QConfig 动态获取，不走 `/v1/models` API
4. **Token 换取失败格式**：`{ "message": "目标用户未生效 Coding Plan 套餐", "success": false }`
5. **SSO 映射**：Ctrip SSO 的 `profile.employee ?? profile.eid` 映射为 `username`，即为 empcode

---

## 方案选择

### 选定方案：Ada 改用 OpenAI Chat Completions 协议

**Why**：Ada 同时提供 Anthropic Messages 和 OpenAI Chat Completions 两种协议。由于 Ada 要求 Bearer 认证，而 OpenAI SDK 的 `apiKey` 参数自动转换为 `Authorization: Bearer` 头，使用 OpenAI Chat Completions 协议可以天然解决认证问题，无需写专用 runtime 或修改通用工厂。

### 对比其他方案

| 方案                               | 优势                        | 劣势                                 |
| ---------------------------------- | --------------------------- | ------------------------------------ |
| A: 专用 Runtime                    | 封装完整                    | 需要新文件，实现 fetch + stream 解析 |
| B: 扩展 anthropicCompatibleFactory | 共享能力                    | 侵入通用层，YAGNI                    |
| **选定: OpenAI Compatible**        | **最简洁，SDK 天然 Bearer** | **需要改 sdkType，但这是合理的**     |

---

## 架构设计

### 请求流程

```
用户请求 Ada 模型
    ↓
initModelRuntimeFromDB(db, userId, 'ada')
    ↓
AdaTokenService.exchangeToken(userId)
    ├── 查 DB: users.username → empcode
    ├── 调 Ada token exchange: POST /api/coding-plan/integration-apps/token/exchange
    │   Body: { appId, appSecret, empcode }
    ├── 返回检查: success=true → 取 token; success=false → 抛 NoCodingPlanError
    └── 缓存: Map<userId, { token, expiresAt }>
    ↓
patch payload: apiKey = exchangedToken, baseURL = Ada endpoint
    ↓
getParamsFromPayload → { apiKey, baseURL, ...payload }
    ↓
LobeAdaAI (openaiCompatibleFactory)
    ├── OpenAI SDK 自动发 Authorization: Bearer <token>
    ├── handlePayload → model 加 ada- 前缀
    └── 请求 /coding-plan/v1/chat/completions
```

### Ada Token Service

**文件**：`src/server/services/adaToken/index.ts`

职责：

1. 根据 userId 查 DB 获取 username (empcode)
2. 调 Ada token exchange 接口
3. 进程内缓存 + 并发去重

#### 缓存策略

- `Map<userId, { token, expiresAt }>` — 进程内 token 缓存
- `Map<userId, Promise<string>>` — 并发去重（同一用户并发请求复用同一次 exchange）
- TTL：优先使用接口返回的 `expiresAt`，本地提前 5 分钟失效
- 不上 Redis—— 多实例每用户 24 小时仅换一次，频率可接受

#### 错误分类

| 错误类型                | 触发条件                             | 前端表现                                              |
| ----------------------- | ------------------------------------ | ----------------------------------------------------- |
| `NoCodingPlanError`     | token exchange 返回 `success: false` | "你的企业套餐未激活 Coding Plan" + 跳转链接到激活页面 |
| `EmpcodeNotFoundError`  | 用户 username 为空                   | "请通过 Ctrip SSO 登录"                               |
| `AdaConfigMissingError` | ADA_APP_ID 或 ADA_APP_SECRET 未配置  | "服务端未配置"                                        |
| `AdaGatewayError`       | HTTP 请求失败（5xx、网络错误）       | "Ada 服务暂时不可用"                                  |

#### Token 换取失败响应处理

Ada token exchange 在用户没有 Coding Plan 时返回：

```json
{
  "message": "目标用户未生效 Coding Plan 套餐",
  "success": false
}
```

`AdaTokenService` 需检查 `success` 字段：

- `success: true` → 取 `token` 字段，缓存并返回
- `success: false` → 抛出 `NoCodingPlanError`，附带 `message` 字段供前端展示

### Ada Runtime 改造

**文件**：`packages/model-runtime/src/providers/ada/index.ts`

从 `createAnthropicCompatibleRuntime` 改为 `createOpenAICompatibleRuntime`：

```typescript
export const LobeAdaAI = createOpenAICompatibleRuntime({
  baseURL: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, ...rest } = payload;
      // 追加 ada- 前缀
      const adaModel = model.startsWith('ada-') ? model : `ada-${model}`;
      return { ...rest, model: adaModel, stream: rest.stream ?? true };
    },
  },
  provider: ModelProvider.Ada,
});
```

### Ada Provider Card 改造

**文件**：`packages/model-bank/src/modelProviders/ada.ts`

```typescript
settings: {
  disableBrowserRequest: true,
  sdkType: 'openai',           // 从 'anthropic' 改为 'openai'
  showApiKey: false,           // 隐藏 API Key 输入框
  showChecker: true,           // 保留连接检测
  // proxyUrl 字段删除（undefined） → 前端不展示 Endpoint 输入框
  showModelFetcher: false,
  modelEditable: false,
  showAddNewModel: false,
}
```

### 环境变量

**文件**：`src/envs/llm.ts`

```typescript
server: {
  ADA_APP_ID: z.string().optional(),
  ADA_APP_SECRET: z.string().optional(),
},
runtimeEnv: {
  ADA_APP_ID: process.env.ADA_APP_ID,
  ADA_APP_SECRET: process.env.ADA_APP_SECRET,
},
```

`.env.example` 补充：

```bash
# Ada Coding Plan Integration
# ADA_APP_ID=cpapp_xxx
# ADA_APP_SECRET=cpapp_sec_xxx
```

### ModelRuntime 初始化 Patch

**文件**：`src/server/modules/ModelRuntime/index.ts`

在 Ztrip patch 逻辑之后，为 Ada 加 server-side patch：

```typescript
if (runtimeProvider === ModelProvider.Ada) {
  const adaTokenService = new AdaTokenService(db);
  const adaPatch = await adaTokenService.exchangeToken(userId);
  payload = {
    ...payload,
    apiKey: adaPatch,
    baseURL: payload.baseURL ?? 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  };
}
```

### 前端 Provider "已配置" 状态

当前前端根据 `keyVaults.apiKey` 是否有值来判断 provider 是否可用。SSO 模式下用户不填 keyVaults，前端会误判为 "未配置"。

解决方案：在 `AiInfraRepos.getAiProviderRuntimeState` 的返回中，对 Ada provider，如果环境变量 `ADA_APP_ID` 已配置，则在 `keyVaults` 中注入标记值 `apiKey: 'sso-managed'`，让前端判断逻辑正常工作。

### 没有 Coding Plan 的前端提示

连接检测失败或聊天请求失败时，如果错误类型是 `NoCodingPlanError`，前端展示特殊提示：

- 文案："你的企业套餐未激活 Coding Plan"
- 跳转链接：`https://aicoding.portal.ctripcorp.com/codingPlan`

需要修改错误映射逻辑（可能在 `ChatInvalidApiKey.tsx` 或 Ada 相关错误处理位置），针对 Ada provider 的 `NoCodingPlanError` 展示专用 UI。

**错误传递路径**：

1. `AdaTokenService.exchangeToken()` 抛出 `NoCodingPlanError`
2. `initModelRuntimeFromDB()` 捕获该错误，需要将错误类型写入 runtime 初始化的 error response
3. `checkProviderConnectivity` 或前端 chat 请求收到错误后，根据 error type 判断是否展示跳转链接

---

## 影响文件清单

### 必改

| 文件                                                | 操作 | 说明                                               |
| --------------------------------------------------- | ---- | -------------------------------------------------- |
| `src/envs/llm.ts`                                   | 修改 | 新增 `ADA_APP_ID`、`ADA_APP_SECRET`                |
| `.env.example`                                      | 修改 | 补充 Ada 环境变量示例                              |
| `src/server/services/adaToken/index.ts`             | 新增 | Ada Token 换取服务                                 |
| `src/server/modules/ModelRuntime/index.ts`          | 修改 | Ada server-side patch                              |
| `packages/model-runtime/src/providers/ada/index.ts` | 修改 | 改用 OpenAI Compatible Runtime + handlePayload     |
| `packages/model-bank/src/modelProviders/ada.ts`     | 修改 | sdkType='openai', showApiKey=false, proxyUrl=false |

### 可能要改

| 文件                                                     | 操作 | 说明                          |
| -------------------------------------------------------- | ---- | ----------------------------- |
| `packages/database/src/repositories/aiInfra/index.ts`    | 修改 | Ada provider 已配置状态注入   |
| `src/features/Conversation/Error/`                       | 修改 | NoCodingPlanError 专用错误 UI |
| `packages/model-runtime/src/providers/ada/index.test.ts` | 修改 | 更新测试                      |

---

## 测试计划

### AdaTokenService

- 命中缓存 → 直接返回
- 过期后刷新 → 重新换 token
- 并发去重 → 同一用户并发请求只换一次
- empcode 不存在 → 抛 EmpcodeNotFoundError
- appId/appSecret 未配置 → 抛 AdaConfigMissingError
- exchange 返回 `success: false` → 抛 NoCodingPlanError
- exchange HTTP 失败 → 抛 AdaGatewayError

### Ada Runtime

- handlePayload 加 ada- 前缀 → `claude-sonnet-4-6` 变为 `ada-claude-sonnet-4-6`
- 已有 ada- 前缀的 model 不重复加
- apiKey 传入后 OpenAI SDK 自动发 Authorization: Bearer

### ModelRuntime 初始化

- Ada 场景在 runtime 初始化前拿到 patch
- patch 优先级：用户未填 keyVaults 时用 SSO token

---

## 风险与缓解

| 风险                                         | 缓解措施                                                    |
| -------------------------------------------- | ----------------------------------------------------------- |
| Token 获取失败导致请求失败                   | 错误分类明确，前端展示专用提示                              |
| 多进程 / 多容器缓存不共享                    | 每实例每 24 小时独立换取一次，频率可接受                    |
| users.username 非 empcode（非 SSO 登录用户） | 仅 SSO 用户写入 empcode；非 SSO 用户 token 换取会失败并提示 |
| QConfig 模型列表与 Ada 实际支持不匹配        | QConfig 是企业级配置中心，由运维维护，通常一致              |
| 环境变量未配置                               | `optional()`，未配置时 Ada 返回友好错误                     |

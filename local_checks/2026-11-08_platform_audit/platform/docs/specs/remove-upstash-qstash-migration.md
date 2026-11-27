# SPEC: 移除 Upstash QStash / Workflow 依赖

| 属性     | 值                                                                                      |
| -------- | --------------------------------------------------------------------------------------- |
| 状态     | Draft                                                                                   |
| 分支建议 | `dev/qstash` 或 `feat/remove-upstash`                                                   |
| 目标     | 运行时零 `@upstash/qstash` / `@upstash/workflow` 调用，依赖可删除                       |
| 原则     | 复用 AgentTasks 已验证模式：Service 编排 + workflows-hono 薄传输 + Local 调度 + DB 幂等 |
| 非目标   | 不新建 workflow-runtime 封装包；不引入 BullMQ/pg-boss 等新中间件                        |

---

## 1. 背景与动机

当前项目通过两类 Upstash 产品支撑异步能力：

1. **`@upstash/qstash`**：`publishJSON` 延迟 HTTP、签名校验、Agent 步骤队列
2. **`@upstash/workflow`**：`serve()` / `context.run()` 多步骤工作流（记忆提取、Agent Eval）

AgentTasks 系统（commit `830851f`）已示范正确替代路径：

- 业务：`TaskRunnerService` / `runScheduleTick` / `runHeartbeatTick`
- 传输：`workflows-hono` 普通 HTTP（Hono）
- 调度：`LocalTaskScheduler`（`setTimeout`）vs `QStashTaskScheduler`（待删除）
- 幂等：DB 重读 task 状态，不依赖 Workflow 步骤记忆

本 SPEC 将 AgentTasks 模式扩展到记忆提取与 Agent Eval，并彻底清除 QStash 残留。

---

## 2. 现状清单

### 2.1 依赖包

| 包                  | 版本（当前） | 用途                                       |
| ------------------- | ------------ | ------------------------------------------ |
| `@upstash/qstash`   | 2.8.4        | Client.publishJSON、Receiver.verify        |
| `@upstash/workflow` | 0.2.23       | serve、WorkflowClient.trigger、context.run |

相关：`patches/@upstash__qstash.patch`、`package.json` scripts `qstash`（dev CLI）

### 2.2 模块依赖图（当前）

```
@/libs/qstash
├── qstashClient          → memory workflow qstashClient、taskScheduler、agent-eval
├── workflowClient        → AgentEvalRunWorkflow、MemoryExtractionWorkflowService
└── verifyQStashSignature → qstashAuth、/api/agent、/api/agent/run、bot-callback

src/server/services/queue/impls/qstash.ts     → AGENT_RUNTIME_MODE=queue
src/server/services/taskScheduler/impls/qstash.ts → AGENT_RUNTIME_MODE=queue

Upstash Workflow routes（待删除）:
├── memory-user-memory/   (8 files)
└── agent-eval-run/       (8 files，其中 2 个已是 plain route)

workflows-hono/task/       (保留，需去 QStash 化)
```

### 2.3 环境变量（待废弃）

| 变量                                        | 当前用途                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| `ZXQSTASH_TOKEN`                            | Client / WorkflowClient 认证                           |
| `QSTASH_CURRENT_SIGNING_KEY`                | Receiver 验签                                          |
| `QSTASH_NEXT_SIGNING_KEY`                   | Receiver 验签                                          |
| `QSTASH_URL`                                | 自定义 QStash endpoint                                 |
| `AGENT_RUNTIME_MODE=queue`                  | 启用 QStash 队列 + QStash TaskScheduler                |
| `MEMORY_USER_MEMORY_WORKFLOW_EXTRA_HEADERS` | Vercel bypass headers（可保留，改用于 internal fetch） |

### 2.4 功能与 QStash 绑定关系

| 功能                         | 当前实现                                        | 迁移后                             |
| ---------------------------- | ----------------------------------------------- | ---------------------------------- |
| Agent 对话步骤               | LocalQueue（默认）/ QStashQueue                 | 仅 LocalQueue                      |
| AgentTasks schedule 模式     | scheduleDispatch + QStash fan-out（queue 模式） | 内联 `runScheduleTick`             |
| AgentTasks heartbeat         | Local setTimeout / QStash delay                 | 仅 LocalTaskScheduler              |
| AgentTasks on-topic-complete | webhook `delivery: 'qstash'`                    | `delivery: 'fetch'` + internalAuth |
| 记忆 UI 分析                 | MemoryExtractionWorkflowService.trigger         | Orchestrator + async/memory        |
| 记忆每小时扫描               | call-cron-hourly-analysis workflow              | orchestrator.runHourlyScan + cron  |
| Persona 更新                 | persona workflow                                | orchestrator.updatePersona         |
| Agent Eval benchmark         | agent-eval-run workflows                        | EvalOrchestrator + local hooks     |
| Bot 桥接                     | webhookDelivery: 'qstash'                       | webhookDelivery: 'fetch'           |

---

## 3. 目标架构

### 3.1 分层模板（与 AgentTasks 对齐）

```
┌─────────────────────────────────────────────────────────┐
│ 触发层                                                   │
│  tRPC lambda / Webhook / Cron POST / 用户操作            │
└───────────────────────────┬─────────────────────────────┘
                            │ fire-and-forget（可选）
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 编排层（*Orchestrator / run*Tick）                       │
│  分页循环、p-map 并发、状态检查、错误处理                  │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 业务层（已有 Service）                                    │
│  MemoryExtractionExecutor / TaskRunnerService /          │
│  AgentEvalRunService / AiAgentService                     │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 持久化                                                   │
│  PostgreSQL（tasks、async_tasks、topics、memories…）       │
└─────────────────────────────────────────────────────────┘

传输层（仅跨进程/跨请求时需要）:
  workflows-hono/*  或  /trpc/async/*
  中间件: internalAuth()（INTERNAL_WEBHOOK_SECRET）
```

### 3.2 调度策略

| 场景                | 机制                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Agent 步骤间延迟    | `LocalQueueServiceImpl.scheduleMessage`（setTimeout）                                                                            |
| Task heartbeat 续跑 | `LocalTaskScheduler.scheduleNextTopic`                                                                                           |
| 定时任务扫描        | QSchedule → `POST /api/workflows/task/schedule-dispatch`（[MVP §2](./internal-scheduler-manager.md#2-mvp-实施方案已确认) job A） |
| 卡死检测            | QSchedule → `POST /api/workflows/task/watchdog`（可选，非 MVP 三目标）                                                           |
| Task heartbeat 续跑 | QSchedule → `POST /api/internal/scheduler/tick`（MVP job C，仅 messages）                                                        |
| 记忆每小时扫描      | QSchedule → `POST /api/internal/memory/hourly`（MVP job B；完整版单 tick 见 SPEC §4+）                                           |
| 长任务续跑          | `createAsyncCaller` → `/trpc/async/memory.*`                                                                                     |

**不引入**进程外消息队列。多实例下 cron 打 HTTP 到任意 healthy 实例即可。

### 3.3 鉴权替代 `qstashAuth`

新建 `src/server/workflows-hono/middlewares/internalAuth.ts`：

```typescript
/**
 * 保护内部 webhook / cron 触发的 HTTP 端点。
 * - 配置 INTERNAL_WEBHOOK_SECRET 时要求 Authorization: Bearer <secret>
 * - 未配置时跳过（本地开发）
 */
export const internalAuth = (): MiddlewareHandler => async (c, next) => {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (secret) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${secret}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  await next();
};
```

`/api/agent/run` 等端点：保留 `AGENT_EXEC_API_KEY` 路径，删除 `verifyQStashSignature` 分支。

---

## 4. 实施阶段

### Phase 0：基础设施（预估 0.5 天）

#### 4.0.1 新增 internalAuth

- [ ] 创建 `src/server/workflows-hono/middlewares/internalAuth.ts`
- [ ] 单测：有 / 无 secret、错误 token

#### 4.0.2 新增环境变量

在 `calcifer.env` / 部署文档中：

```bash
# 内部 webhook 鉴权（cron、自调用 HTTP）
INTERNAL_WEBHOOK_SECRET=""

# 废弃（迁移完成后删除）
# ZXQSTASH_TOKEN
# QSTASH_CURRENT_SIGNING_KEY
# QSTASH_NEXT_SIGNING_KEY
# AGENT_RUNTIME_MODE=queue
```

#### 4.0.3 废弃 enableQueueAgentRuntime 的 QStash 分支

- [ ] `src/server/services/queue/impls/index.ts`：删除 `QStashQueueServiceImpl` 分支，始终 `LocalQueueServiceImpl`
- [ ] `src/server/services/taskScheduler/impls/index.ts`：删除 `QStashTaskScheduler` 分支，始终 `LocalTaskScheduler`
- [ ] 删除文件：
  - `src/server/services/queue/impls/qstash.ts`
  - `src/server/services/taskScheduler/impls/qstash.ts`
  - `src/server/services/taskScheduler/impls/qstash.test.ts`
- [ ] 更新 `QueueService.test.ts`：删除 queue 模式 QStash 相关用例
- [ ] `src/envs/app.ts`：移除或标记 deprecated `enableQueueAgentRuntime`（可选保留字段恒为 false）

---

### Phase 1：AgentTasks 去 QStash 化（预估 1 天）

AgentTasks 业务逻辑已完成，本阶段仅切断 QStash 依赖链。

#### 4.1.1 替换中间件

- [ ] `src/server/workflows-hono/task/index.ts`：`qstashAuth()` → `internalAuth()`
- [ ] 删除 `src/server/workflows-hono/middlewares/qstashAuth.ts`（迁移完成后）

#### 4.1.2 scheduleDispatch 去掉 QStash fan-out

文件：`src/server/workflows-hono/task/handlers/scheduleDispatch.ts`

- [ ] 删除 `import { qstashClient } from '@/libs/qstash'`
- [ ] 删除 `appEnv.enableQueueAgentRuntime` 分支
- [ ] `fanout()` 仅保留内联 `runScheduleTick` 路径（已存在，约 L136–151）

#### 4.1.3 Webhook 投递改 fetch

| 文件                                                       | 改动                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/server/services/taskRunner/index.ts`                  | `delivery: 'qstash'` → `'fetch'`                                         |
| `src/server/services/bot/AgentBridgeService.ts`            | `webhookDelivery: 'qstash'` → `'fetch'`                                  |
| `src/server/services/agentRuntime/hooks/types.ts`          | 默认 `delivery` 改为 `'fetch'`；类型可保留 union 一段时间后删除 `qstash` |
| `src/server/services/agentRuntime/hooks/HookDispatcher.ts` | 删除 `delivery === 'qstash'` 分支                                        |
| `src/server/services/agentRuntime/AgentRuntimeService.ts`  | 删除 `deliverWebhook` 中 qstash 分支                                     |

本地模式：`HookDispatcher` 已支持 in-process handler；生产 webhook 走 `fetch` 到 `INTERNAL_APP_URL`。

#### 4.1.4 定时触发文档 / 部署

生产需配置 cron（二选一）：

```bash
# 每 30 分钟扫描 schedule 模式任务
*/30 * * * * curl -X POST "$APP_URL/api/workflows/task/schedule-dispatch" \
  -H "Authorization: Bearer $INTERNAL_WEBHOOK_SECRET"

# 每 5 分钟 watchdog
*/5 * * * * curl -X POST "$APP_URL/api/workflows/task/watchdog" \
  -H "Authorization: Bearer $INTERNAL_WEBHOOK_SECRET"
```

可选：进程内 `node-cron`（仅单实例 dev）— 非必须，优先外部 cron。

#### 4.1.5 验收标准

- [ ] `rg '@upstash|@/libs/qstash' src/server/workflows-hono` 无结果
- [ ] `task.run` + schedule 模式任务在本地可手动 `POST schedule-dispatch` 触发执行
- [ ] heartbeat 模式任务 `LocalTaskScheduler` 续跑正常
- [ ] `on-topic-complete` 在 queue 步骤完成后通过 fetch 回调生效

---

### Phase 2：记忆提取迁移（预估 3–4 天）

#### 4.2.1 新建编排服务

**文件**：`src/server/services/memory/userMemory/orchestrator.ts`

从以下 workflow route **搬迁编排逻辑**（非复制业务，业务已在 `MemoryExtractionExecutor`）：

| 原 workflow route                    | 迁移动作                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `process-users/route.ts`             | `orchestrator.processUsers(payload)`                                   |
| `process-user-topics/route.ts`       | `orchestrator.processUserTopics(payload)`                              |
| `process-topics/route.ts`            | `orchestrator.processTopicBatch(payload)`                              |
| `process-topic/workflows/topic.ts`   | `orchestrator.processSingleTopic(payload)` — CEPA 并行 + Identity 串行 |
| `call-cron-hourly-analysis/route.ts` | `orchestrator.runHourlyScan({ cursor, dryRun })`                       |
| `persona/update-writing/route.ts`    | `orchestrator.updatePersona(userIds)`                                  |

**常量**（从原 route 保留）：

```typescript
const USER_PAGE_SIZE = 50; // process-users
const USER_BATCH_SIZE = 10;
const USER_PAGE_SIZE_HOURLY = 200; // hourly
const USER_BATCH_SIZE_HOURLY = 20;
const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;
const TOPIC_PARALLELISM = 5; // 原 flowControl.parallelism
```

**并发**：使用 `p-map`（项目已有），替代 `flowControl`：

```typescript
import pMap from 'p-map';

await pMap(topicIds, (topicId) => orchestrator.processSingleTopic({ ... }), {
  concurrency: TOPIC_PARALLELISM,
});
```

**幂等**：依赖现有 `MemoryExtractionExecutor.extractTopic` + `forceAll` / `forceTopics` + AsyncTask 进度；不实现 Workflow 步骤缓存。

**公开 API**：

```typescript
export class MemoryExtractionOrchestrator {
  static async runUserExtraction(params: MemoryExtractionNormalizedPayload): Promise<void>;
  static async runHourlyScan(params: HourlyScanParams): Promise<HourlyScanResult>;
  static async updatePersona(userIds: string[]): Promise<void>;
}
```

#### 4.2.2 新建 async router

**文件**：`src/server/routers/async/memory.ts`

```typescript
export const memoryRouter = router({
  runUserExtraction: internalProcedure
    .input(z.object({ taskId: z.string().uuid(), userId: z.string(), fromDate: ..., toDate: ... }))
    .mutation(async ({ input }) => {
      const orchestrator = await MemoryExtractionOrchestrator.create();
      await orchestrator.runUserExtraction({ ...input, asyncTaskId: input.taskId });
    }),

  runHourlyPage: internalProcedure
    .input(z.object({ cursor: z.object({ createdAt: z.string(), id: z.string() }).optional(), dryRun: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      await MemoryExtractionOrchestrator.runHourlyScan(input);
    }),
});
```

- [ ] 注册到 `src/server/routers/async/index.ts`
- [ ] 使用与 `createAsyncCaller` 相同的 internal JWT 鉴权

#### 4.2.3 新建 workflows-hono 入口（可选，用于 cron）

**文件**：`src/server/workflows-hono/memory/index.ts`

```typescript
const app = new Hono().basePath('/api/internal/memory');
app.post('/hourly', internalAuth(), hourlyHandler);
app.post('/extract', internalAuth(), extractHandler); // webhook 兼容
export default app;
```

**挂载**：`src/app/(backend)/api/internal/memory/[[...route]]/route.ts`

与 task workflow 并列，避免路由冲突。

#### 4.2.4 改触发入口

| 入口                                                                                | 改动                                                                                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/server/routers/lambda/userMemory.ts` `requestMemoryFromChatTopic`              | 删除 `MemoryExtractionWorkflowService.triggerProcessUsers`；改为 `createAsyncCaller` → `memory.runUserExtraction` |
| `src/app/(backend)/api/webhooks/memory-extraction/route.ts`                         | 默认 `mode: 'direct'` 或统一走 async；删除 workflow 分支                                                          |
| `src/app/(backend)/api/webhooks/memory-user-memory/persona/update-writing/route.ts` | 调用 `orchestrator.updatePersona`                                                                                 |
| `src/server/services/memory/userMemory/extract.ts`                                  | 删除 `MemoryExtractionWorkflowService` 类、`WORKFLOW_PATHS`、`getWorkflowClient`                                  |

#### 4.2.5 删除 Upstash Workflow routes

删除目录：

```
src/app/(backend)/api/workflows/memory-user-memory/
```

#### 4.2.6 配置调整

- [ ] `normalizeMemoryExtractionPayload` 默认 `mode: 'async'`（或移除 mode 字段）
- [ ] `parseMemoryExtractionConfig`：`upstashWorkflowExtraHeaders` 改名为 `internalFetchExtraHeaders` 或删除

#### 4.2.7 验收标准

- [ ] 记忆 UI「分析聊天话题」可触发，AsyncTask 进度正常递增
- [ ] Webhook `POST /api/webhooks/memory-extraction` 返回 202
- [ ] `POST /api/internal/memory/hourly` 分页扫描用户并处理
- [ ] Persona 更新 webhook 可用
- [ ] `rg 'memory-user-memory' src/app` 无 workflow route 残留

---

### Phase 3：Agent Eval 迁移（预估 2–3 天）

#### 4.3.1 现状

- `AgentEvalRunService` 已有 **local hooks** 路径（`onComplete` handler 内联 `recordTrajectoryCompletion`）
- Workflow 主要用于 benchmark 批量 fan-out：`run-benchmark` → `paginate-test-cases` → `execute-test-case` → trajectories → `finalize-run`

#### 4.3.2 新建编排服务

**文件**：`src/server/services/agentEvalRun/orchestrator.ts`

```typescript
export class AgentEvalRunOrchestrator {
  static async runBenchmark(params: {
    runId: string;
    userId: string;
    dryRun?: boolean;
  }): Promise<void>;
  static async paginateAndExecute(params: PaginateParams): Promise<void>;
  static async executeTestCase(params: ExecuteTestCaseParams): Promise<void>;
  static async finalizeRun(params: { runId: string; userId: string }): Promise<void>;
}
```

逻辑自以下 route 搬迁：

- `run-benchmark/route.ts`
- `paginate-test-cases/route.ts`
- `execute-test-case/route.ts`
- `run-agent-trajectory/route.ts`
- `run-thread-trajectory/route.ts`
- `finalize-run/route.ts`

**触发方式**：

- 入口：`AgentEvalRunWorkflow.triggerRunBenchmark` → 改为 `createAsyncCaller` → `async/eval.runBenchmark`
- 或 tRPC mutation 内 fire-and-forget

**单测执行**：优先复用 `AgentEvalRunService` + local hooks，删除对 workflow webhook 的依赖。

保留 plain routes（无需迁移）：

- `on-trajectory-complete/route.ts`
- `on-thread-complete/route.ts`

改为 `internalAuth` + 直接调 service 方法。

#### 4.3.3 删除

```
src/app/(backend)/api/workflows/agent-eval-run/  （除 on-*-complete 可迁至 workflows-hono/eval）
src/server/workflows/agentEvalRun/index.ts       （WorkflowClient.trigger 封装）
```

#### 4.3.4 验收标准

- [ ] 可启动 benchmark run，test case 批量执行完成
- [ ] run 状态正确流转至 finalized
- [ ] `rg 'agent-eval-run' src/app/(backend)/api/workflows` 无 serve () route

---

### Phase 4：清理与删除（预估 1 天）

#### 4.4.1 删除模块

- [ ] `src/libs/qstash/` 整个目录
- [ ] `patches/@upstash__qstash.patch`
- [ ] `package.json` 中 `@upstash/qstash`、`@upstash/workflow`、`scripts.qstash`
- [ ] `packages/observability-otel/.../upstash-workflow`（若无其他引用）
- [ ] skills 中 upstash-workflow 文档可标记 deprecated 或更新

#### 4.4.2 更新 API 路由鉴权

| 文件                                                         | 改动                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `src/app/(backend)/api/agent/route.ts`                       | 删除 `verifyQStashSignature`，仅 `AGENT_EXEC_API_KEY` |
| `src/app/(backend)/api/agent/run/route.ts`                   | 同上                                                  |
| `src/app/(backend)/api/agent/webhooks/bot-callback/route.ts` | 改用 `internalAuth` 逻辑或 API key                    |

#### 4.4.3 全局搜索验收

```bash
rg '@upstash/qstash|@upstash/workflow|@/libs/qstash|ZXQSTASH_TOKEN|verifyQStashSignature|qstashAuth' src packages
# 期望：0 结果（测试 mock 除外）
```

#### 4.4.4 依赖

```bash
pnpm remove @upstash/qstash @upstash/workflow
bun run type-check
```

---

## 5. 文件变更总表

### 5.1 新增

| 路径                                                          | 说明                   |
| ------------------------------------------------------------- | ---------------------- |
| `src/server/workflows-hono/middlewares/internalAuth.ts`       | 内部 HTTP 鉴权         |
| `src/server/services/memory/userMemory/orchestrator.ts`       | 记忆提取编排           |
| `src/server/routers/async/memory.ts`                          | 记忆后台执行           |
| `src/server/workflows-hono/memory/index.ts`                   | 记忆 cron/webhook HTTP |
| `src/app/(backend)/api/internal/memory/[[...route]]/route.ts` | Next 挂载              |
| `src/server/services/agentEvalRun/orchestrator.ts`            | Eval 编排              |
| `src/server/routers/async/eval.ts`                            | Eval 后台执行（可选）  |

### 5.2 修改

| 路径                                                          | 说明                   |
| ------------------------------------------------------------- | ---------------------- |
| `src/server/workflows-hono/task/index.ts`                     | internalAuth           |
| `src/server/workflows-hono/task/handlers/scheduleDispatch.ts` | 去掉 qstash fan-out    |
| `src/server/services/taskRunner/index.ts`                     | webhook delivery fetch |
| `src/server/routers/lambda/userMemory.ts`                     | async 触发             |
| `src/server/services/memory/userMemory/extract.ts`            | 删除 WorkflowService   |
| `src/server/services/queue/impls/index.ts`                    | 仅 local               |
| `src/server/services/taskScheduler/impls/index.ts`            | 仅 local               |
| `calcifer.env`                                                | 新 env，废弃 QStash    |

### 5.3 删除

| 路径                                                                     |
| ------------------------------------------------------------------------ |
| `src/libs/qstash/`                                                       |
| `src/server/services/queue/impls/qstash.ts`                              |
| `src/server/services/taskScheduler/impls/qstash.ts`                      |
| `src/server/workflows-hono/middlewares/qstashAuth.ts`                    |
| `src/app/(backend)/api/workflows/memory-user-memory/**`                  |
| `src/app/(backend)/api/workflows/agent-eval-run/**`（workflow serve 版） |
| `src/server/workflows/agentEvalRun/index.ts`                             |
| `patches/@upstash__qstash.patch`                                         |

---

## 6. 环境变量 SPEC（迁移后）

| 变量                           | 必填     | 说明                              |
| ------------------------------ | -------- | --------------------------------- |
| `APP_URL` / `INTERNAL_APP_URL` | 是       | 自调用 HTTP、webhook fetch 目标   |
| `INTERNAL_WEBHOOK_SECRET`      | 生产建议 | cron / 内部 endpoint Bearer 鉴权  |
| `AGENT_EXEC_API_KEY`           | 可选     | `/api/agent` 外部调用鉴权         |
| `REDIS_URL`                    | 可选     | Agent 状态 / 流（非 QStash 依赖） |

**删除**：`QSTASH_*`、`AGENT_RUNTIME_MODE=queue`

---

## 7. 测试计划

### 7.1 单元测试

| 模块                         | 文件                                                    |
| ---------------------------- | ------------------------------------------------------- |
| internalAuth                 | `internalAuth.test.ts`                                  |
| MemoryExtractionOrchestrator | `orchestrator.test.ts` — mock executor，验证分页 / 并发 |
| scheduleDispatch fanout      | 更新 `scheduleTick.test.ts`，删除 qstash.test           |
| QueueService                 | 删除 queue 模式用例                                     |

### 7.2 集成测试

| 场景                                         | 验证                                       |
| -------------------------------------------- | ------------------------------------------ |
| `userMemory.requestMemoryFromChatTopic`      | AsyncTask Pending → Success，progress 递增 |
| `POST /api/workflows/task/schedule-dispatch` | due task 被执行                            |
| Task heartbeat                               | 多轮 tick 续跑                             |
| Agent Eval benchmark                         | run 完整生命周期                           |
| `rg @upstash`                                | 源码零引用                                 |

### 7.3 手动测试清单

- [ ] 记忆页选择日期范围 → 分析 → 进度条更新 → 记忆写入
- [ ] 创建 schedule 模式 Task（cron `*/30 * * * *`）→ 手动触发 dispatch → Agent 执行
- [ ] heartbeat 模式 Task → 完成后自动下一轮
- [ ] Bot（若启用）回调正常
- [ ] 无 `ZXQSTASH_TOKEN` 启动应用无报错

---

## 8. 风险与缓解

| 风险                              | 缓解                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| 长任务 HTTP 超时                  | 按页 / 批拆分 async 调用，单次 mutation 只处理一批               |
| cron 未配置导致 schedule 任务不跑 | 部署文档 + 健康检查告警；提供 tRPC 手动 dispatch（可选）         |
| fetch webhook 投递失败            | AgentRuntime 已有 log-only；Task 有 local handler 双路径         |
| 多实例重复执行 cron               | dispatch 内 DB 幂等（`isExecutionTime` + lastHeartbeatAt dedup） |
| 记忆重复提取                      | executor 层 forceTopics + topic 已提取标记                       |

---

## 9. 回滚策略

按 Phase 独立回滚：

1. Phase 4 前可随时 `git revert` 对应 phase
2. 保留 `feat/agent-tasks-migration` 基线；记忆 / Eval 迁移在独立 PR
3. 不建议保留 QStash 双后端；若必须临时回滚，恢复 `libs/qstash` 与 workflow routes 即可

---

## 10. PR 拆分建议

| PR   | 内容                                      | 依赖        |
| ---- | ----------------------------------------- | ----------- |
| PR-1 | Phase 0 + Phase 1（AgentTasks 去 QStash） | 无          |
| PR-2 | Phase 2（记忆提取）                       | PR-1        |
| PR-3 | Phase 3（Agent Eval）                     | PR-1        |
| PR-4 | Phase 4（删除依赖）                       | PR-2 + PR-3 |

---

## 11. 完成定义（Definition of Done）

- [ ] `rg '@upstash/qstash|@upstash/workflow' src packages` 无匹配（测试除外）
- [ ] `package.json` 无 `@upstash/*` 依赖
- [ ] 应用在无 `QSTASH_*` 环境变量下正常启动
- [ ] 记忆分析、AgentTasks 定时 / 心跳、Agent Eval benchmark 功能回归通过
- [ ] `calcifer.env` 与部署文档已更新
- [ ] `bun run type-check` 通过
- [ ] 相关 vitest 通过

---

## 附录 A：记忆 Workflow → Orchestrator 方法映射

```
triggerProcessUsers(payload)
  → orchestrator.runUserExtraction(payload)
      loop users (paginate)
        → processUserTopics(userIds batch)

processUserTopics
  loop users
    loop topics (paginate)
      → processTopicBatch(topicIds batch)

processTopicBatch
  pMap(topicIds, processSingleTopic, { concurrency: 5 })

processSingleTopic
  executor.extractTopic(CEPA layers)
  executor.extractTopic(Identity layers)

triggerHourly({ cursor, dryRun })
  → orchestrator.runHourlyScan()
      getUsersForHourlyExtraction(page)
      chunk → runUserExtraction per batch
      if nextCursor → async/memory.runHourlyPage (续页)

triggerPersonaUpdate(userId)
  → orchestrator.updatePersona([userId])
```

## 附录 B：AgentTasks HTTP 端点（迁移后保留）

| Method | Path                                    | 鉴权         | 用途                                |
| ------ | --------------------------------------- | ------------ | ----------------------------------- |
| POST   | `/api/workflows/task/schedule-dispatch` | internalAuth | 中央 cron 扫描                      |
| POST   | `/api/workflows/task/schedule-execute`  | internalAuth | 单任务执行（可选，dispatch 已内联） |
| POST   | `/api/workflows/task/heartbeat-tick`    | internalAuth | QStash 删除后仅 local 自调用保留    |
| POST   | `/api/workflows/task/on-topic-complete` | internalAuth | Agent 完成回调                      |
| POST   | `/api/workflows/task/watchdog`          | internalAuth | 卡死检测                            |

## 附录 C：与旧 agent_cron_jobs 关系

- `agent_cron_jobs` 表 / UI **不在本 SPEC 范围**；新系统使用 `tasks.automation_mode = 'schedule'`
- 无需为 `agent_cron_jobs` 实现执行器
- 产品层引导用户使用 AgentTasks + builtin-tool-task

# SPEC: 内部统一调度器（Internal Scheduler Manager）

| 属性     | 值                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------- |
| 状态     | **已确认 — MVP 路径**（§2）；§3 起为 Phase 2+ 完整版，暂缓                                          |
| 分支建议 | `feat/internal-scheduler`                                                                           |
| 包名     | `@lobechat/internal-scheduler`                                                                      |
| 适用项目 | `@ctrip/calcifer-chathub`（Next 多实例 + PostgreSQL/Neon，已移除 QStash）                           |
| 目标     | 保证 **schedule Task /heartbeat/ 定时记忆提取** 三类任务可靠执行（多实例 + 重启可恢复）             |
| 原则     | **MVP 优先**（见附录 C）：能复用现有 HTTP handler 则不新建抽象；仅 heartbeat 必须 DB 化             |
| 完整版   | 附录 A/B 描述的统一 Scheduler（QStash 风格 API + 三表 + 单 tick）— **非 MVP 必做**，可分期          |
| 非目标   | 不模拟 `@upstash/workflow`；不引入 Redis/BullMQ；不替代 Agent 步骤队列；不统一 `agent_cron_jobs` UI |

**文档导读**：实现请只读 **§2 MVP**；§3–§14 为统一 Scheduler 完整版设计，待 MVP 验收后再按需引入。

---

## 1. 背景与动机

### 1.1 现状问题

| 场景                     | 当前实现                                                         | 问题                                 |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------ |
| schedule 模式 Agent Task | `POST /api/workflows/task/schedule-dispatch` + `isExecutionTime` | 依赖多个分散 HTTP 端点；无统一注册表 |
| 记忆 hourly 扫描         | `POST /api/internal/memory/hourly`                               | 无扫描级去重；与 task 调度割裂       |
| watchdog                 | `POST /api/workflows/task/watchdog`                              | 同上                                 |
| heartbeat 续跑           | `LocalTaskScheduler`（`setTimeout`）                             | **服务重启后定时链断裂**             |
| 外部触发                 | 需配置 3+ 条 cron                                                | 运维复杂                             |

### 1.2 设计目标

1. **QStash 风格 API**：`schedules.create / delete / list / get`，以及 `messages.publish`（延迟一次性消息，用于 heartbeat 恢复）。
2. **DB 为唯一真相**：注册、注销、上次执行时间、待投递延迟消息均落库；**重启可恢复**。
3. **单例 Manager**：Next.js 启动时 `initInternalScheduler()` 一次，全局 `getInternalScheduler()`。
4. **外部 cron 驱动**：Manager **不** `setInterval`；由 QSchedule（`@ctrip/vampire-schedule`）每分钟触发 `POST /api/internal/scheduler/tick`。
5. **多实例安全**：tick 入口全局 advisory lock + 单 job 执行锁 + `lastExecutedAt` 去重。

### 1.3 与 QStash 的对应关系

| QStash API                                                           | Internal Scheduler 等价物                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `client.schedules.create({ destination, cron, scheduleId?, body? })` | `scheduler.schedules.create({ handlerKey, cron, scheduleId?, payload? })` |
| `client.schedules.delete(scheduleId)`                                | `scheduler.schedules.delete(scheduleId)`                                  |
| `client.schedules.list()`                                            | `scheduler.schedules.list()`                                              |
| `client.publishJSON({ url, body, delay })`                           | `scheduler.messages.publish({ handlerKey, body, delaySeconds })`          |
| QStash 云端 cron 触发 destination                                    | 外部 cron → `/api/internal/scheduler/tick` → Manager 扫描 DB              |

> **说明**：`destination` 在 QStash 是 HTTP URL；完整版改为 `handlerKey`（§6 Package）。**MVP 不使用该模型**，见 §2。

---

## 2. MVP 实施方案（已确认）

保证三类任务可靠执行：**Schedule Task**、**Heartbeat**、**定时记忆提取**。仅 heartbeat 需新建 DB + Manager；其余复用现有 HTTP handler + QSchedule。

### 2.1 三目标与缺口

| 目标          | 现网                                    | MVP 动作                                          |
| ------------- | --------------------------------------- | ------------------------------------------------- |
| Schedule Task | `schedule-dispatch` + `isExecutionTime` | QSchedule → 现有 HTTP，**不改 handler**           |
| Heartbeat     | `LocalTaskScheduler`，重启断链          | `messages` 表 + `/tick` + `rearmHeartbeatMessage` |
| 记忆 hourly   | `memory/hourly` + fetch 自链            | QSchedule → 现有 HTTP，**MVP 不改自链**           |

### 2.2 架构：3 条 QSchedule job

```text
QSchedule（运维控制台配 cron）
├── job A  calcifer.node.chathub.task.schedule-dispatch
│          → POST /api/workflows/task/schedule-dispatch     （已有）
├── job B  calcifer.node.chathub.memory.hourly
│          → POST /api/internal/memory/hourly                 （已有）
└── job C  calcifer.node.chathub.scheduler.tick
           → POST /api/internal/scheduler/tick               （新建，仅处理 messages）
```

- **禁止**将 A/B 并入 job C，避免 QSchedule 与 DB `schedules` 双层 cron（Phase 2+ 才考虑统一 tick）。
- **watchdog** 不在三目标内；可保留第四条 QSchedule 指向原 `/watchdog`，与 MVP 无关。

job A/B 使用 manager 包内通用 `qschedule/http-job.cjs`（配置 `targetPath` + env）；job C 使用 `qschedule/tick-job.cjs`。

### 2.3 数据模型：仅 `internal_scheduler_messages`

完整 DDL 见 §5.2（原 §4.2）。MVP **不建** `internal_scheduler_schedules`、`internal_scheduler_locks`（测试环境可用 PG advisory，无需租约表）。

| MVP 需要                             | MVP 不需要                                      |
| ------------------------------------ | ----------------------------------------------- |
| `messages` 表 + publish/claim/cancel | `schedules` 表、builtin upsert、`isScheduleDue` |
| tick 全局 advisory 锁                | schedule 级锁、平台 `last_executed_at`          |
| `processing` 僵死回收（10min）       | schedules 管理 API                              |

### 2.4 Package：`@lobechat/internal-scheduler`（MVP 子集）

```text
packages/internal-scheduler/
├── src/
│   ├── MessageScheduler.ts       # publish / tick / cancel（无 schedules 子系统）
│   ├── helpers/heartbeat.ts      # rearmHeartbeatMessage
│   └── integration/
│       ├── bootstrap.ts          # bootstrapScheduler({ mode: 'messages-only' })
│       ├── http.ts               # createSchedulerHonoApp → POST /tick
│       └── qschedule.ts          # registerQScheduleJobs(A/B/C)
└── qschedule/
    ├── tick-job.cjs              # job C
    └── http-job.cjs              # job A/B
```

```typescript
// MVP 对外 API
messages.publish({ handlerKey: 'task.heartbeat-tick', body, delaySeconds, metadata });
messages.cancelPendingByMetadata({ taskId });
tick(); // 仅投递 due messages，注册单一 handler：task.heartbeat-tick
```

`bootstrapScheduler` 内部：组装 `SchedulerRepository`（仅 messages 相关方法）+ `LockProvider` + 注册 heartbeat handler + 可选 `registerQScheduleJobs`。

### 2.5 应用层改动（最小）

| 文件                                               | 改动                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/instrumentation.node.ts`                      | `bootstrapScheduler({ getDb, mode: 'messages-only', qschedule: { jobs: [...] } })` |
| `src/server/workflows-hono/scheduler/index.ts`     | `createSchedulerHonoApp` 薄转发（\~8 行）                                          |
| `src/app/.../scheduler/[[...route]]/route.ts`      | 挂载                                                                               |
| `src/server/services/taskLifecycle/index.ts`       | `rearmHeartbeatMessage(...)` 一行；`<60s` 可保留 Local 双写                        |
| `schedule-dispatch` / `memory/hourly` / `watchdog` | **不改逻辑**（仅 QSchedule 注册）                                                  |

**无需**：`handlers.ts` 四合一、删 hourly fetch 自链、`internal_scheduler_schedules`。

### 2.6 QSchedule 注册（`integration/qschedule.ts`）

```typescript
await registerQScheduleJobs([
  {
    jobName: 'calcifer.node.chathub.task.schedule-dispatch',
    jobDesc: 'Schedule 模式 Task 扫描',
    jobWorker: resolveHttpJobPath(),
    jobWorkerEnv: { QSCHEDULE_HTTP_PATH: '/api/workflows/task/schedule-dispatch' },
  },
  {
    jobName: 'calcifer.node.chathub.memory.hourly',
    jobDesc: '记忆 hourly 扫描',
    jobWorker: resolveHttpJobPath(),
    jobWorkerEnv: { QSCHEDULE_HTTP_PATH: '/api/internal/memory/hourly' },
  },
  {
    jobName: 'calcifer.node.chathub.scheduler.tick',
    jobDesc: 'Heartbeat messages tick',
    jobWorker: resolveTickJobPath(),
  },
]);
```

`jobName` 可通过 `SCHEDULER_QSCHEDULE_*` 环境变量覆盖。

### 2.7 MVP 环境变量

| 变量                           | 必填     | 说明                             |
| ------------------------------ | -------- | -------------------------------- |
| `INTERNAL_WEBHOOK_SECRET`      | 生产建议 | 所有 internal HTTP job 鉴权      |
| `INTERNAL_APP_URL`             | 是       | jobWorker `fetch` 基址           |
| `DISABLE_INTERNAL_SCHEDULER`   | 否       | `1` 跳过 bootstrap               |
| `SCHEDULER_QSCHEDULE_ENABLED`  | 否       | `1` 注册 A/B/C（默认生产开）     |
| `SCHEDULER_TICK_MESSAGE_LIMIT` | 否       | 单次 tick 投递上限，默认 100     |
| `SCHEDULER_MESSAGE_LEASE_MS`   | 否       | processing 僵死回收，默认 600000 |

### 2.8 MVP 实施阶段

**Phase 0（1–2 天）**

- [ ] `packages/internal-scheduler` MVP 子集 + `internal_scheduler_messages` migration
- [ ] `MessageScheduler.tick` + advisory 锁 + 僵死回收 + 单测
- [ ] `rearmHeartbeatMessage` + `qschedule/tick-job.cjs` + `http-job.cjs`

**Phase 1（1–2 天）**

- [ ] `instrumentation` + `/api/internal/scheduler/tick` 路由
- [ ] `taskLifecycle` 接入 `rearmHeartbeatMessage`（+ 可选 Local 双写）
- [ ] QSchedule 注册 job A/B/C；运维控制台配 cron（A/C: 每分钟，B: 每小时）
- [ ] 停用手写 curl / 旧 QStash cron（避免双跑）

**Phase 2（可选，触发条件见 §2.9）**

- 引入 §3 起完整版能力

### 2.9 MVP → 完整版升级条件

| 条件                        | 引入                                         |
| --------------------------- | -------------------------------------------- |
| memory fetch 自链不稳定     | `messages` 续页 + `createChainedPageHandler` |
| 运维要求 DB 管 builtin cron | `internal_scheduler_schedules` + 单 tick     |
| 需 schedule 管理 API        | QStash 风格 `schedules.*`                    |
| watchdog 要统一入口         | 扩展 `tick()`                                |

### 2.10 MVP 验收标准

- [ ] job A：schedule Task 在配置时刻执行（`cronEval` 回归用例）
- [ ] job B：hourly 至少完成一页扫描
- [ ] job C：`rearm` 后杀进程，2 分钟内 `runHeartbeatTick` 被调用
- [ ] 多实例：并发 job C 仅一个实例处理 messages
- [ ] **未**创建 `internal_scheduler_schedules` 表
- [ ] `bunx vitest run packages/internal-scheduler` + `bun run type-check` 通过

### 2.11 MVP 文件清单

| 路径                                           | 操作                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| `packages/internal-scheduler/**`               | 新增（MVP 子集）                                          |
| `packages/database/.../internalScheduler.ts`   | 新增（仅 messages schema + repository）                   |
| `packages/database/migrations/0xxx_*.sql`      | 新增（仅 messages 表）                                    |
| `src/instrumentation.node.ts`                  | 修改                                                      |
| `src/server/workflows-hono/scheduler/index.ts` | 新增                                                      |
| `src/app/.../scheduler/[[...route]]/route.ts`  | 新增                                                      |
| `src/server/services/taskLifecycle/index.ts`   | 修改                                                      |
| `package.json`（根）                           | `@lobechat/internal-scheduler`、`@ctrip/vampire-schedule` |

---

## 3. 项目约束与修订（Phase 2+，暂缓）

本节根据当前仓库实际情况，对初版 SPEC 的补充与修正。**实现前必读。**

### 2.1 双层调度模型（勿混淆）

```text
┌─ 平台层：internal_scheduler_schedules.last_executed_at ─────────────┐
│  控制 builtin job 多久跑一次（dispatch / watchdog / memory.hourly）   │
└────────────────────────────┬──────────────────────────────────────┘
                             │ tick 触发 handler
                             ▼
┌─ 业务层：tasks 表（用户 Agent Task）──────────────────────────────┐
│  schedule 模式：tasks.schedule_pattern + tasks.lastHeartbeatAt      │
│  → dispatch handler 内 isExecutionTime 判断是否执行 runScheduleTick  │
│  （见 packages/utils/src/cronEval.test.ts 手动触发回归用例）          │
└────────────────────────────────────────────────────────────────────┘
```

维护 scheduler 表 **不能替代** `tasks` 上的 schedule 语义；二者各司其职。

### 2.2 系统边界（本调度器不覆盖）

| 模块                                         | 现状                                                  | 本 SPEC                                      |
| -------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `agent_cron_jobs` 表 + UI                    | 有 CRUD（`agentCronJob` router），**无执行器**        | **不替代**；产品仍走 `tasks.automation_mode` |
| `POST /api/workflows/task/on-topic-complete` | Agent 完成后 webhook                                  | **保留**，不由 scheduler 替代                |
| `LocalQueueService`                          | Agent 步骤 `setTimeout` 延迟                          | **非目标**；重启仍丢步骤，后续另议           |
| 用户主动记忆提取                             | `async/memory.runExtraction` + `continueTopicBatches` | **不走** scheduler                           |
| `updatePersona`                              | 记忆提取后异步触发                                    | 默认不注册；若需定时 persona 另加 job        |
| `/api/internal/eval/*`                       | Eval webhook 已存在                                   | Phase 3+ 可选纳入 scheduler                  |

### 2.3 Phase 0 阻塞项（必须先定案）

| #   | 议题                   | 决议                                                                             |
| --- | ---------------------- | -------------------------------------------------------------------------------- |
| 1   | **memory.hourly 分页** | 采用 **§8.5 方案 B**（MVP 不实施，继续 fetch 自链）                              |
| 2   | **heartbeat 时间精度** | MVP：**§2** `rearmHeartbeatMessage`；完整版 **§8.4** 混合 Local + DB             |
| 3   | **分布式锁**           | 采用 **§5.4 LockProvider**：生产 PG advisory；测试 / PGLite 用租约表             |
| 4   | **message 僵死**       | `processing` 超租约 → 回收为 `pending`（§5.5）                                   |
| 5   | **tick 持锁失败**      | HTTP **200** + `{ skipped: true, reason: 'tick_lock_held' }`，避免 cron 重试风暴 |
| 6   | **迁移期双跑**         | 切换日 **停旧 cron**；旧端点仅 deprecation 转发或硬禁用（§7.5）                  |

### 2.4 初始化与运行环境

| 约束                                  | 说明                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **DB 迁移先于 bootstrap**             | `instrumentation` 里 upsert builtin schedules 前，表必须已 migrate                                     |
| `**NODE_ENV=test`\*\*                 | `getServerDB()` 返回空 mock（`db-adaptor.ts`），须 `DISABLE_INTERNAL_SCHEDULER=1` 或跳过 bootstrap     |
| **Next 多 worker**                    | 每进程各有一份内存 Handler Registry（正常）；builtin upsert 须幂等                                     |
| `**@ctrip/vampire-core` bootstrap\*\* | 与 scheduler 初始化顺序：vampire bootstrap →（可选 OTel）→ scheduler bootstrap                         |
| **Vercel 部署**                       | 若 `VERCEL_ENV` 存在，`tick` 受 `maxDuration` 限制；长 job 须 messages 链式，禁止单 route 扫全量       |
| **calcifer 内网 LB**                  | QSchedule 经 Dubbo 打到任一实例；`tick` 内 DB 全局锁保证多实例不重复执行                               |
| **外部 cron 接入**                    | calcifer 使用 `**@ctrip/vampire-schedule`\*\*（QSchedule SDK），非运维手写 curl；本地 dev 可 curl 兜底 |

### 2.5 Handler 注册 API 修正

初版 bootstrap 示例误用 `scheduler.registerHandler`。正确方式：

```typescript
initInternalScheduler({
  repository,
  handlers: {
    'task.schedule-dispatch': async (ctx) => { ... },
    'memory.hourly': async (ctx) => { ... },
  },
});
// 或 init 后：getInternalScheduler().registerHandler(...) 暴露在 Manager，不放在 Client
```

`SchedulerClient` 仅暴露 `schedules` / `messages` / `tick`（QStash 对外 API 子集）。

### 2.6 薄集成原则（manager 外最少改动）

**目标**：`src/` 侧只保留三类代码，其余全部进 `@lobechat/internal-scheduler`。

| 留在应用层（不可避免）                | 封装进 manager                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ |
| 业务 handler 实现（调现有 service）   | `tick()` 引擎、锁、去重、message 状态机                                  |
| `getServerDB()` 注入                  | `createSchedulerRepository` / `createPgAdvisoryLockProvider` 组装        |
| `instrumentation` 一行 bootstrap 调用 | QSchedule `register` + 内置 `jobWorker` 路径                             |
| —                                     | builtin schedule 种子数据（`presets/calcifer.ts`）                       |
| —                                     | memory 分页续跑（`createChainedPageHandler`）                            |
| —                                     | heartbeat `messages.publish` / `cancelPending`（`helpers/heartbeat.ts`） |
| —                                     | Hono `/tick` 路由工厂（`integration/http.ts`）                           |
| —                                     | 环境变量解析、`TickResult` → HTTP 响应                                   |

**应用层禁止再写**：`schedules/index.ts`、`scheduler-tick-job.ts`、独立 `bootstrap.ts` 里 80 行组装逻辑、hourly handler 内 `messages.publish` 续页、taskLifecycle 内 message SQL。

**对外集成面**（应用只调这一个入口）：

```typescript
import { bootstrapScheduler } from '@lobechat/internal-scheduler/integration';

await bootstrapScheduler({
  getDb: getServerDB,
  handlers: calciferHandlers, // 见 §7.1（Phase 2+）
  preset: 'calcifer',
  qschedule: true,
});
```

### 2.7 Database 包接入方式

Repository 实现建议与现有模式一致：

- Schema：`packages/database/src/schemas/internalScheduler.ts`
- Model：`packages/database/src/models/internalScheduler.ts`（或 `SchedulerRepository` 类）
- 在 `packages/database/package.json` 增加 exports（若需子路径）：`"./internal-scheduler": "..."`
- 根项目 `package.json` 增加 `"@lobechat/internal-scheduler": "workspace:*"`

---

## 4. 目标架构（Phase 2+）

```text
┌──────────────────────────────────────────────────────────────────┐
│ QSchedule 平台（cron 在运维控制台配置，建议 1 分钟）                  │
│   → Dubbo ScheduleMessageHandler.handle                           │
│   → @ctrip/vampire-schedule ScheduleRunner                        │
│   → jobWorker 子进程执行 → POST /api/internal/scheduler/tick      │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ @lobechat/internal-scheduler                                      │
│  InternalSchedulerManager（单例）                                 │
│    tick()                                                         │
│      1. pg_try_advisory_lock('scheduler:tick')                    │
│      2. 扫描 internal_scheduler_schedules（cron due）             │
│      3. 扫描 internal_scheduler_messages（not_before <= now）     │
│      4. 执行 handler → 更新 last_executed_at / message status     │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Handler Registry（Next 启动时 registerHandler）                   │
│  - task.schedule-dispatch                                         │
│  - task.watchdog                                                  │
│  - memory.hourly                                                  │
│  - task.heartbeat-tick   （由 messages.publish 延迟触发）          │
│  - … 业务扩展                                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 分层职责

| 层               | 位置                                      | 职责                                                                                     |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Package 核心** | `packages/internal-scheduler`             | Manager、Tick 引擎、Client API、Integration 层                                           |
| **Package 集成** | `packages/internal-scheduler/integration` | `bootstrapScheduler`、QSchedule、HTTP 路由工厂、builtin preset、分页 /heartbeat 助手     |
| **Database**     | `packages/database`                       | 表 schema、Model、`SchedulerRepository` + `LockProvider` 实现（由 integration 自动组装） |
| **应用 handler** | `src/server/scheduler/handlers.ts`        | **仅** 4 个业务 handler 函数体（\~30 行）                                                |
| **Transport**    | `src/server/workflows-hono/scheduler`     | **薄转发**：`export default createSchedulerHonoApp(...)`（\~5 行）                       |
| **Init**         | `src/instrumentation.node.ts`             | `bootstrap()` + `bootstrapScheduler(...)`（\~8 行）                                      |

---

## 5. 数据库设计（Phase 2+）

### 4.1 表：`internal_scheduler_schedules`

周期性 Cron 任务（对应 QStash Schedules）。

```sql
CREATE TABLE IF NOT EXISTS internal_scheduler_schedules (
  id                text PRIMARY KEY,              -- scheduleId，用户指定或 nanoid
  handler_key       text NOT NULL,                 -- 如 'memory.hourly'
  cron              text NOT NULL,                 -- 5 段 cron，支持 CRON_TZ= 前缀
  cron_timezone     text DEFAULT 'UTC',            -- 解析后冗余存储，便于查询展示
  enabled           boolean NOT NULL DEFAULT true,
  payload           jsonb NOT NULL DEFAULT '{}',     -- 传给 handler 的静态参数
  last_executed_at  timestamptz,
  last_status       text,                          -- 'success' | 'error' | 'skipped'
  last_error        text,
  last_duration_ms  integer,
  metadata          jsonb NOT NULL DEFAULT '{}',   -- 来源、描述、owner 等
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_scheduler_schedules_enabled_idx
  ON internal_scheduler_schedules (enabled);

CREATE INDEX IF NOT EXISTS internal_scheduler_schedules_handler_key_idx
  ON internal_scheduler_schedules (handler_key);
```

**Drizzle 文件**：`packages/database/src/schemas/internalScheduler.ts`

### 4.2 表：`internal_scheduler_messages`

一次性 / 延迟消息（对应 QStash `publishJSON` + `delay`），**用于 heartbeat 重启恢复**。

```sql
CREATE TABLE IF NOT EXISTS internal_scheduler_messages (
  id                text PRIMARY KEY,              -- messageId
  handler_key       text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  not_before        timestamptz NOT NULL,            -- earliest delivery time
  status            text NOT NULL DEFAULT 'pending', -- pending | processing | delivered | failed | canceled
  retries           integer NOT NULL DEFAULT 0,
  max_retries       integer NOT NULL DEFAULT 3,
  locked_at         timestamptz,                     -- 多实例 claim
  locked_by         text,                            -- instance id
  last_error        text,
  delivered_at      timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_scheduler_messages_due_idx
  ON internal_scheduler_messages (status, not_before);

CREATE INDEX IF NOT EXISTS internal_scheduler_messages_handler_key_idx
  ON internal_scheduler_messages (handler_key);

-- heartbeat 取消 pending 时按 taskId 查询（§8.2）
CREATE INDEX IF NOT EXISTS internal_scheduler_messages_metadata_task_id_idx
  ON internal_scheduler_messages ((metadata->>'taskId'))
  WHERE status = 'pending';
```

**可选列**：若 JSON 查询性能不足，可增加冗余列 `ref_task_id text`（heartbeat 专用）。

### 4.3 幂等与去重字段

| 机制                                           | 说明                                                                                               |     |        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | --- | ------ |
| `schedules.last_executed_at` + `isScheduleDue` | **平台 builtin job** 的去重（复用 `@lobechat/utils/cronEval`）                                     |     |        |
| `tasks.lastHeartbeatAt` + `isExecutionTime`    | **用户 schedule Task** 的去重（在 dispatch handler 内，不变）                                      |     |        |
| `messages` 状态机                              | `pending → processing → delivered`，`FOR UPDATE SKIP LOCKED` 领取                                  |     |        |
| tick 全局锁                                    | session 级 `pg_try_advisory_lock(hashtext('lobe:scheduler:tick'))`，tick 结束 `pg_advisory_unlock` |     |        |
| schedule 执行锁                                | \`pg_try_advisory_lock(hashtext('lobe:scheduler:schedule:'                                         |     | id))\` |

### 4.4 LockProvider 抽象

生产与测试使用不同实现，通过 `InitInternalSchedulerOptions.lockProvider` 注入：

| 实现                     | 场景                          | 行为                                                                 |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------- |
| `PgAdvisoryLockProvider` | 生产 PostgreSQL / Neon        | `pg_try_advisory_lock` / `unlock`                                    |
| `LeaseRowLockProvider`   | PGLite 单测、无 advisory 环境 | 表 `internal_scheduler_locks(lock_key, holder, expires_at)` CAS 租约 |

```sql
CREATE TABLE IF NOT EXISTS internal_scheduler_locks (
  lock_key    text PRIMARY KEY,
  holder      text NOT NULL,
  expires_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

默认租约：tick 锁 120s；schedule 锁 600s；message `processing` 回收见 §5.5。

### 4.5 Message 僵死恢复

每次 `tick()` **开头**（拿 tick 锁之后）执行：

```sql
UPDATE internal_scheduler_messages
SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now()
WHERE status = 'processing'
  AND locked_at < now() - interval '10 minutes';
```

超过 `max_retries` 的失败 message 标为 `failed`，写 `last_error`，可选写 urgent brief（后续）。

### 4.6 Migration

```bash
# 在 packages/database 修改 schema 后
bun run db:generate
# 重命名为有意义文件名，如 0xxx_add_internal_scheduler_tables.sql
```

---

## 6. Package 设计（Phase 2+ 完整版）：`@lobechat/internal-scheduler`

### 5.1 目录结构

```text
packages/internal-scheduler/
├── package.json
├── qschedule/
│   └── tick-job.cjs             # 随包发布；QSchedule jobWorker 默认路径（无需应用侧编译）
└── src/
    ├── index.ts                   # 核心 API：Client、init、types
    ├── client/                    # QStash 风格门面
    ├── manager/                   # tick 引擎、单例
    ├── registry/
    ├── repository/types.ts        # Repository / LockProvider 接口
    ├── eval/isScheduleDue.ts
    ├── presets/
    │   └── calcifer.ts            # 3 条 builtin schedule 定义
    ├── helpers/
    │   ├── chainedPage.ts         # createChainedPageHandler（memory.hourly 续页）
    │   └── heartbeat.ts           # rearmHeartbeatMessage / cancelHeartbeatMessages
    └── integration/
        ├── index.ts               # bootstrapScheduler（对外唯一集成入口）
        ├── bootstrap.ts           # getDb → repository + lockProvider + init + seed
        ├── http.ts                # createSchedulerHonoApp / createTickHandler
        ├── qschedule.ts           # registerQScheduleTick（封装 @ctrip/vampire-schedule）
        └── env.ts                 # 解析 SCHEDULER_* / INTERNAL_* 环境变量
```

### 5.2 依赖

```json
{
  "dependencies": {
    "@lobechat/utils": "workspace:*",
    "@lobechat/database": "workspace:*"
  },
  "exports": {
    ".": "./src/index.ts",
    "./integration": "./src/integration/index.ts",
    "./helpers/chainedPage": "./src/helpers/chainedPage.ts",
    "./qschedule/tick-job": "./qschedule/tick-job.cjs"
  },
  "name": "@lobechat/internal-scheduler",
  "peerDependencies": {
    "@ctrip/vampire-schedule": ">=1.0.0",
    "hono": "*"
  },
  "peerDependenciesMeta": {
    "@ctrip/vampire-schedule": { "optional": true },
    "hono": { "optional": true }
  }
}
```

- **Repository + LockProvider** 仍在 `packages/database`，由 `integration/bootstrap.ts` 内部 `createSchedulerRepository(getDb())` 组装，**应用不传** repository。
- **QSchedule** 为 optional peer：`qschedule: false` 时（本地 dev）跳过 `ScheduleMonitor.register`。

### 5.3 核心类型

```typescript
/** Handler 执行上下文 */
export interface SchedulerHandlerContext {
  scheduleId?: string;
  messageId?: string;
  payload: Record<string, unknown>;
  triggeredAt: Date;
  /** 幂等键，如 'schedule:memory.hourly:2026-06-10T14' */
  idempotencyKey: string;
}

export type SchedulerHandler = (ctx: SchedulerHandlerContext) => Promise<void>;

export interface CreateScheduleInput {
  /** 对应 QStash scheduleId；重复 create 同 id 则 upsert 覆盖 */
  scheduleId: string;
  handlerKey: string;
  cron: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PublishMessageInput {
  messageId?: string;
  handlerKey: string;
  body: Record<string, unknown>;
  /** 延迟秒数，对应 QStash delay */
  delaySeconds: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface TickOptions {
  dryRun?: boolean;
  /** 单次 tick 最多处理多少条 schedule / message */
  limits?: { schedules?: number; messages?: number };
}

export interface TickResult {
  success: boolean;
  dryRun: boolean;
  /** 未抢到 tick 全局锁时为 true；HTTP 仍返回 200 */
  skipped?: boolean;
  reason?: 'tick_lock_held';
  schedules: { total: number; due: number; executed: number; skipped: number; errors: string[] };
  messages: { total: number; due: number; delivered: number; failed: number; errors: string[] };
  durationMs: number;
}
```

### 5.4 QStash 风格 Client API

```typescript
export class SchedulerClient {
  constructor(private readonly manager: InternalSchedulerManager) {}

  readonly schedules = {
    create: (input: CreateScheduleInput) => this.manager.upsertSchedule(input),
    delete: (scheduleId: string) => this.manager.deleteSchedule(scheduleId),
    get: (scheduleId: string) => this.manager.getSchedule(scheduleId),
    list: () => this.manager.listSchedules(),
    pause: (scheduleId: string) => this.manager.setScheduleEnabled(scheduleId, false),
    resume: (scheduleId: string) => this.manager.setScheduleEnabled(scheduleId, true),
  };

  readonly messages = {
    publish: (input: PublishMessageInput) => this.manager.publishMessage(input),
    cancel: (messageId: string) => this.manager.cancelMessage(messageId),
    /** heartbeat rearm：取消同 taskId 的 pending messages */
    cancelPendingByMetadata: (filter: { taskId: string }) =>
      this.manager.cancelPendingMessagesByMetadata(filter),
  };

  /** 供外部 cron 调用；也可在进程内测试直接调 */
  tick: (options?: TickOptions) => this.manager.tick(options);
}
```

### 5.5 单例与初始化

```typescript
// packages/internal-scheduler/src/manager/singleton.ts

let manager: InternalSchedulerManager | null = null;

export interface InitInternalSchedulerOptions {
  repository: SchedulerRepository;
  lockProvider: LockProvider;
  /** 代码注册的 handler；DB 中的 handler_key 必须在此存在 */
  handlers?: Record<string, SchedulerHandler>;
  /** 当前实例标识，用于 message claim */
  instanceId?: string;
  onHandlerError?: (error: unknown, ctx: SchedulerHandlerContext) => void;
}

export function initInternalScheduler(options: InitInternalSchedulerOptions): SchedulerClient {
  if (manager) return new SchedulerClient(manager);
  manager = new InternalSchedulerManager(options);
  return new SchedulerClient(manager);
}

/** 仅用于 bootstrap 追加 handler；不暴露在 SchedulerClient 上 */
export function registerSchedulerHandler(key: string, handler: SchedulerHandler): void;

export function getInternalScheduler(): SchedulerClient {
  if (!manager) {
    throw new Error(
      'Internal scheduler not initialized. Call initInternalScheduler() in instrumentation.node.ts first.',
    );
  }
  return new SchedulerClient(manager);
}
```

### 5.6 `tick()` 算法（伪代码）

```typescript
async tick(options?: TickOptions): Promise<TickResult> {
  const started = Date.now();
  const tickLock = await this.lockProvider.tryAcquire('lobe:scheduler:tick', 120);
  if (!tickLock) {
    return { success: true, skipped: true, reason: 'tick_lock_held', dryRun: !!options?.dryRun, ... };
  }

  try {
    await this.repository.reclaimStaleProcessingMessages({ olderThanMs: 600_000 });

    const now = new Date();
    const scheduleLimit = options?.limits?.schedules ?? envDefault(50);
    const messageLimit = options?.limits?.messages ?? envDefault(100);

    // ── Phase A: schedules ──
    for (const row of await this.repository.listEnabledSchedules(scheduleLimit)) {
      if (!isScheduleDue(row.cron, row.lastExecutedAt, row.cronTimezone, now)) continue;
      if (options?.dryRun) continue;
      if (!await this.lockProvider.tryAcquire(`lobe:scheduler:schedule:${row.id}`, 600)) continue;
      try {
        await this.runHandler(row.handlerKey, { scheduleId: row.id, payload: row.payload, ... });
        await this.repository.markScheduleSuccess(row.id, now);
      } catch (e) {
        await this.repository.markScheduleError(row.id, formatError(e));
      } finally {
        await this.lockProvider.release(`lobe:scheduler:schedule:${row.id}`);
      }
    }

    // ── Phase B: messages（SKIP LOCKED）──
    for (const msg of await this.repository.claimDueMessages(messageLimit, this.instanceId)) {
      try {
        await this.runHandler(msg.handlerKey, { messageId: msg.id, payload: msg.payload, ... });
        await this.repository.markMessageDelivered(msg.id);
      } catch (e) {
        await this.repository.markMessageFailedOrRetry(msg.id, e);
      }
    }
  } finally {
    await this.lockProvider.release('lobe:scheduler:tick');
  }

  return { success: true, durationMs: Date.now() - started, ... };
}
```

### 5.7 Integration 层 API（复杂逻辑集中于此）

#### `bootstrapScheduler`（`integration/index.ts`）

```typescript
export interface BootstrapSchedulerOptions {
  /** 应用唯一需要注入的 DB 来源 */
  getDb: () => Promise<ServerDB>;
  /** 业务 handler；key 须覆盖 preset 引用的 handlerKey */
  handlers: Record<string, SchedulerHandler>;
  /** 内置 schedule 种子；`calcifer` 加载 presets/calcifer.ts */
  preset?: 'calcifer';
  /** 是否向 QSchedule 注册 tick job；默认读 env SCHEDULER_QSCHEDULE_ENABLED */
  qschedule?: boolean;
  onHandlerError?: InitInternalSchedulerOptions['onHandlerError'];
}

/** 幂等；返回全局 SchedulerClient */
export async function bootstrapScheduler(opts: BootstrapSchedulerOptions): Promise<SchedulerClient>;

/** 供 Hono / taskLifecycle 使用 */
export function getBootstrappedScheduler(): SchedulerClient;
```

内部顺序：`getDb` → `createSchedulerRepository` + `createPgAdvisoryLockProvider` → `initInternalScheduler` → 用 `createChainedPageHandler` 包装 `memory.hourly`（若 preset 含该 key）→ upsert builtin schedules → `registerQScheduleTick`（可选）。

#### `createChainedPageHandler`（`helpers/chainedPage.ts`）

将 §8.5 分页续页逻辑从应用 handler 移入 manager：

```typescript
export function createChainedPageHandler<TCursor>(options: {
  handlerKey: string;
  runPage: (ctx: SchedulerHandlerContext) => Promise<{
    cursor?: TCursor;
    hasNextPage: boolean;
    dryRun?: boolean;
  }>;
}): SchedulerHandler;
```

handler 内只调 `runHourlyScan` 并返回 `{ cursor, hasNextPage }`；**`messages.publish` 续页由 wrapper 自动完成**。

#### `rearmHeartbeatMessage`（`helpers/heartbeat.ts`）

```typescript
export async function rearmHeartbeatMessage(
  scheduler: SchedulerClient,
  input: { taskId: string; userId: string; delaySeconds: number },
): Promise<void>;
// 内部：cancelPendingByMetadata({ taskId }) + messages.publish
```

`taskLifecycle` Phase 2 只改 **一行** 调用此 helper（`<60s` Local 双写仍留在应用层）。

#### `registerQScheduleTick`（`integration/qschedule.ts`）

封装 `@ctrip/vampire-schedule`，对齐 vampire-validate 的 `ScheduleMonitor.register`：

```typescript
export function resolveQScheduleTickJobPath(): string;
// → require.resolve('@lobechat/internal-scheduler/qschedule/tick-job')

export async function registerQScheduleTick(options?: {
  jobName?: string;
  jobDesc?: string;
  jobWorker?: string; // 默认 resolveQScheduleTickJobPath()
}): Promise<void>;
```

**`qschedule/tick-job.cjs`**（随包发布，应用**无需**自建 `scheduler-tick-job.ts`）：

- 子进程内 `fetch(INTERNAL_APP_URL + '/api/internal/scheduler/tick')`
- `monitor.setRateCapacity` / `setRate` / `remoteLogger`（对齐 validate demo-job）
- 将 HTTP 响应 body 写入 `remoteLogger`；`tick_lock_held` 时打 warn 但不 reject（避免 QSchedule 误判失败）

#### `createSchedulerHonoApp`（`integration/http.ts`）

```typescript
export function createSchedulerHonoApp(options: {
  getScheduler: () => SchedulerClient;
  /** 与现有 internalAuth 对齐的鉴权中间件 */
  internalAuth: MiddlewareHandler;
  basePath?: string; // 默认 '/api/internal/scheduler'
}): Hono;
```

内置 `POST /tick`（200 + `TickResult`）、可选 `GET/POST/DELETE /schedules`（builtin 禁止 delete）。

---

## 7. Next.js 集成（Phase 2+ 薄胶水层）

> Phase 2+ 集成方式；**MVP 见 §2.5**。应用侧新增 / 修改文件 **≤ 4 个**，合计 **\~60 行**。

### 6.1 业务 Handler（`src/server/scheduler/handlers.ts`）

**唯一保留的业务代码**；不含锁、续页、builtin upsert、QSchedule。

```typescript
import { createChainedPageHandler } from '@lobechat/internal-scheduler/helpers/chainedPage';
import { MemoryExtractionOrchestrator } from '@/server/services/memory/userMemory/orchestrator';
import { runScheduleDispatchCore } from '@/server/workflows-hono/task/handlers/scheduleDispatch';
import { runWatchdogCore } from '@/server/workflows-hono/task/handlers/watchdog';
import { runHeartbeatTick } from '@/server/services/taskRunner/heartbeatTick';

const runMemoryHourlyPage = createChainedPageHandler({
  handlerKey: 'memory.hourly',
  runPage: async (ctx) => {
    const { cursor, dryRun } = ctx.payload as { cursor?: object; dryRun?: boolean };
    const orchestrator = await MemoryExtractionOrchestrator.create();
    const result = await orchestrator.runHourlyScan({ cursor, dryRun: dryRun ?? false });
    return {
      cursor: result.nextCursor,
      hasNextPage: result.hasNextPage ?? false,
      dryRun,
    };
  },
});

export const calciferSchedulerHandlers = {
  'task.schedule-dispatch': () => runScheduleDispatchCore({ dryRun: false, maxTasksPerTick: 20 }),
  'task.watchdog': () => runWatchdogCore(),
  'memory.hourly': runMemoryHourlyPage,
  'task.heartbeat-tick': (ctx) => {
    const { taskId, userId } = ctx.payload as { taskId: string; userId: string };
    return runHeartbeatTick(taskId, userId);
  },
} satisfies Record<string, SchedulerHandler>;
```

> `scheduleDispatch` / `watchdog` 仍须抽 `*Core()`（既有重构）；hourly 删除 `fetch` 自链。

### 6.2 `instrumentation.node.ts`（\~10 行）

```typescript
import { bootstrap } from '@ctrip/vampire-core';
import { bootstrapScheduler } from '@lobechat/internal-scheduler/integration';
import { calciferSchedulerHandlers } from '@/server/scheduler/handlers';
import { getServerDB } from '@/database/server';

bootstrap();

if (process.env.DISABLE_INTERNAL_SCHEDULER !== '1' && process.env.NODE_ENV !== 'test') {
  await bootstrapScheduler({
    getDb: getServerDB,
    handlers: calciferSchedulerHandlers,
    preset: 'calcifer',
    qschedule: true,
  });
}
```

QSchedule 注册、builtin seed、repository 组装均在 `bootstrapScheduler` 内完成，**无需** `import './schedules'`。

### 6.3 HTTP 路由（\~8 行）

```typescript
// src/server/workflows-hono/scheduler/index.ts
import {
  createSchedulerHonoApp,
  getBootstrappedScheduler,
} from '@lobechat/internal-scheduler/integration';
import { internalAuth } from '@/server/middleware/internalAuth';

export default createSchedulerHonoApp({
  getScheduler: getBootstrappedScheduler,
  internalAuth: internalAuth(),
});
```

**挂载**：`src/app/(backend)/api/internal/scheduler/[[...route]]/route.ts`（与现有 Hono 路由模式一致，无额外逻辑）。

### 6.4 外部 Cron 配置（最终态）

#### calcifer 生产：QSchedule + `@ctrip/vampire-schedule`

| 配置项      | 位置                                                                   | 值                                                             |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| cron 表达式 | **QSchedule 运维控制台**                                               | `0 * * * * ?`（每分钟，按平台 cron 语法）                      |
| jobName     | `registerQScheduleTick`（manager 内）                                  | `calcifer.node.chathub.internal-scheduler.tick`（可 env 覆盖） |
| jobWorker   | `@lobechat/internal-scheduler/qschedule/tick-job`（**随包发布 .cjs**） | 应用侧零文件                                                   |
| 触发链路    | SDK 自动                                                               | Dubbo → 主进程 → 子进程 `require(tick-job.cjs)` → HTTP `/tick` |

`tick-job.cjs` 行为对齐 vampire-validate 的 `demo-job.ts`（`setRateCapacity` / `remoteLogger` /promise → ACK），实现细节全部在 manager 包内维护。

**多实例行为**：每实例 `bootstrapScheduler({ qschedule: true })` 均 register；`tick()` 内 PG advisory 全局锁保证 at-most-once。

**依赖**：`@ctrip/vampire-schedule` 作为 `@lobechat/internal-scheduler` 的 optional peer；根 `package.json` 生产环境声明即可。

#### 本地 / 无 QSchedule 环境（兜底）

```bash
# 开发机手动触发，或 crontab 兜底
* * * * * curl -fsS -X POST "$INTERNAL_APP_URL/api/internal/scheduler/tick" \
  -H "Authorization: Bearer $INTERNAL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

可删除或保留为薄转发的旧端点：

- `/api/workflows/task/schedule-dispatch` → `getSchedulerClient().tick()` 或单跑 dispatch handler
- `/api/internal/memory/hourly` → 单跑 memory handler
- `/api/workflows/task/watchdog` → 单跑 watchdog handler

### 6.5 迁移期双跑禁令

| 阶段              | 外部 cron                                                        | 旧 HTTP 端点                              |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| 并行验证（≤1 周） | 仅 QSchedule tick job **或** 仅旧三条 cron（二选一）             | 可保留                                    |
| 切换完成          | **仅** QSchedule `calcifer.node.chathub.internal-scheduler.tick` | 返回 `410` 或转发到 tick 且打 `warn` 日志 |

**禁止**同时启用 QSchedule tick job 与旧三条 QSchedule/cron（`schedule-dispatch` / `memory/hourly` / `watchdog`），否则会重复执行。

### 6.6 可观测性

- 日志前缀：`[internal-scheduler]`，字段含 `scheduleId` / `messageId` / `handlerKey` / `durationMs`
- 复用 `@lobechat/observability-otel`：span 名 `scheduler.tick`
- `internal_scheduler_schedules.last_status` / `last_error` 可供运维只读 API 展示

---

## 8. 业务迁移：Heartbeat 与 Memory 长任务（Phase 2+）

### 7.1 现状（Heartbeat）

`TaskLifecycleService.maybeRearmHeartbeat` → `LocalTaskScheduler.scheduleNextTopic(delay)` → 进程内 `setTimeout` → **重启丢失**。

### 7.2 迁移后（DB 持久化 + 混合定时）

```typescript
// maybeRearmHeartbeat 内（应用层仅 1 行调度逻辑）
import {
  getBootstrappedScheduler,
  rearmHeartbeatMessage,
} from '@lobechat/internal-scheduler/integration';

await rearmHeartbeatMessage(getBootstrappedScheduler(), {
  taskId: task.id,
  userId: this.userId,
  delaySeconds: task.heartbeatInterval,
});

// 混合策略（§8.4）：短间隔仍用 LocalTaskScheduler 保证精度
if (task.heartbeatInterval < 60) {
  await createTaskSchedulerModule().scheduleNextTopic({
    delay: task.heartbeatInterval,
    taskId: task.id,
    userId: this.userId,
  });
}
```

重启后：DB message 在 `tick` 投递 → `runHeartbeatTick` → `onTopicComplete` → 再次 `publish` → 循环恢复。

### 7.3 `LocalTaskScheduler` 处置

| 阶段    | 动作                                                                           |
| ------- | ------------------------------------------------------------------------------ |
| Phase 2 | heartbeat **必须** `messages.publish`；`<60s` 间隔保留 LocalTaskScheduler 双写 |
| Phase 3 | 评估是否将 tick 提高到 30s；再考虑去掉 LocalTaskScheduler                      |
| Phase 4 | 仅当全量 heartbeat ≥60s 时删除 Local 生产路径                                  |

### 7.4 Heartbeat 与 1 分钟 tick 的精度

| heartbeatInterval | 运行时行为                                           | 重启恢复                          |
| ----------------- | ---------------------------------------------------- | --------------------------------- |
| `< 60s`           | LocalTaskScheduler 触发（精确） + DB message（恢复） | 靠 message，`tick` 最多延迟～1min |
| `≥ 60s`           | 仅 DB message                                        | 完全靠 message                    |

若业务大量依赖 30s heartbeat，可选：外部 cron 改为 `*/30 * * * * `\*（需网关支持秒级）或独立高频 tick 端点（Phase 3+）。

### 7.5 Memory hourly 分页续跑（方案 B，推荐）

**问题**：现网 `runHourlyScan` 每页 200 用户后 `fetch` 自链；放入同步 `tick()` 会导致单页超时或每小时只扫一页。

**决议**：

1. `memory.hourly` handler 只处理 **一页**。
2. 若 `hasNextPage`，`messages.publish({ handlerKey: 'memory.hourly', body: { cursor }, delaySeconds: 0 })`。
3. 下一分钟 `tick` 投递 message，继续扫；**重启不丢 cursor**（在 message payload 中）。
4. 删除 `hourly.ts` 内 fire-and-forget `fetch`。

**注意**：`MEMORY_USER_MEMORY_WHITELIST_USERS` 等过滤仍在 `runHourlyScan` 内生效。

---

## 9. 内置 Schedule 与业务 Schedule 的关系（Phase 2+）

### 8.1 两层模型

| 类型                              | 存储位置                                           | 示例                    |
| --------------------------------- | -------------------------------------------------- | ----------------------- |
| **平台级 Builtin**                | `internal_scheduler_schedules`（bootstrap upsert） | memory.hourly、watchdog |
| **用户 Agent Task schedule 模式** | 仍在 `tasks` 表（`schedule_pattern`）              | 用户配置的「每天 9:00」 |

`task.schedule-dispatch` handler 继续扫描 `**tasks` 表 \*\*，逻辑不变；Builtin schedule 只是「多久调用一次 dispatch 扫描器」。

### 8.2 可选扩展：用户级 Scheduler

未来若需把用户 cron 也迁入 `internal_scheduler_schedules`，可增加：

- `tasks.scheduler_schedule_id` 外键
- 创建 / 更新 Task 时同步 `schedules.create`

**本 SPEC Phase 1 不做**，避免与 `tasks` 双写。

---

## 10. 环境变量（Phase 2+）

| 变量                                 | 必填     | 说明                                                                   |
| ------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `INTERNAL_WEBHOOK_SECRET`            | 生产建议 | `/tick` Bearer 鉴权                                                    |
| `INTERNAL_APP_URL` / `APP_URL`       | 是       | 其他 internal fetch（非 memory 分页）                                  |
| `DISABLE_INTERNAL_SCHEDULER`         | 否       | `1` 时跳过 bootstrap；**测试 CI 建议默认关**                           |
| `SCHEDULER_TICK_SCHEDULE_LIMIT`      | 否       | 单次 tick 最多执行 schedule 数，默认 50                                |
| `SCHEDULER_TICK_MESSAGE_LIMIT`       | 否       | 单次 tick 最多投递 message 数，默认 100                                |
| `SCHEDULER_DISPATCH_MAX_TASKS`       | 否       | dispatch 单 tick 最多执行用户 task 数，默认 20                         |
| `SCHEDULER_MESSAGE_LEASE_MS`         | 否       | `processing` 僵死回收阈值，默认 600000                                 |
| `MEMORY_USER_MEMORY_WHITELIST_USERS` | 否       | hourly 扫描仍受此过滤（业务配置，非 scheduler）                        |
| `SCHEDULER_QSCHEDULE_JOB_NAME`       | 否       | QSchedule 注册名，默认 `calcifer.node.chathub.internal-scheduler.tick` |
| `SCHEDULER_QSCHEDULE_ENABLED`        | 否       | `1` 时 `bootstrapScheduler` 调用 `registerQScheduleTick`；本地可 `0`   |

### 9.1 Builtin 时区

`builtin-memory-hourly` 默认 `CRON_TZ=Asia/Shanghai 0 * * * `\*（可改为 UTC）。与用户 `tasks.schedule_timezone` 独立；文档与运维手册须写清。

---

## 11. 实施阶段（Phase 2+ 完整版，MVP 见 §2.8）

### Phase 0：基础设施（1–2 天）— 阻塞项见 §3.3

- [ ] 新建 `packages/internal-scheduler`（含 `integration/`、`helpers/`、`presets/`、`qschedule/tick-job.cjs`）
- [ ] DB 三表 + `SchedulerRepository` + `LockProvider`（PG + Lease）
- [ ] `tick()` + `bootstrapScheduler` + `createChainedPageHandler` + `rearmHeartbeatMessage`
- [ ] `registerQScheduleTick` + `createSchedulerHonoApp` 单测
- [ ] 单测：去重、`tick_lock_held`、message 租约回收、chainedPage 续页

### Phase 1：接入 Next + QSchedule（1–2 天，应用改动极小）

- [ ] `handlers.ts` + `instrumentation.node.ts`（\~20 行）
- [ ] `workflows-hono/scheduler` 薄转发 + route 挂载
- [ ] `POST /api/internal/scheduler/tick`（经 `createSchedulerHonoApp`）
- [ ] `memory.hourly` messages 分页链（§8.5）
- [ ] `runScheduleDispatchCore({ maxTasksPerTick })` 限并发
- [ ] 迁移期：停旧 cron 清单（§7.5）
- [ ] 更新 `remove-upstash-qstash-migration.md` /calcifer 部署文档

### Phase 2：Heartbeat 持久化（2 天）

- [ ] `maybeRearmHeartbeat`：`messages.publish` + `<60s` Local 双写（§8.4）
- [ ] `cancelPendingByMetadata({ taskId })`
- [ ] 集成测试：杀进程后 tick 仍投递 heartbeat

### Phase 3：清理与观测（1 天）

- [ ] OTel span `scheduler.tick`
- [ ] Admin API：list schedules、manual trigger
- [ ] builtin `metadata.builtin=true` 禁止 delete
- [ ] 旧端点 deprecation / 410

---

## 12. 测试计划（Phase 2+）

### 11.1 Package 单测

| 用例                           | 预期                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| 同一 cron 窗口内连续 tick 两次 | 第二次 `skipped`（`last_executed_at`）                                      |
| 两个实例同时 tick              | 一个 `tick_lock_held`，HTTP 200                                             |
| handler 抛错                   | `last_status=error`；是否更新 `last_executed_at` 按策略（失败不重进同窗口） |
| `messages.publish` delay 30s   | 30s 内 tick 不投递，之后投递                                                |
| `processing` 超过 10min        | 回收为 `pending`                                                            |
| `schedules.create` 同 id       | upsert 覆盖 cron                                                            |
| PGLite 测试                    | `LeaseRowLockProvider` 替代 advisory                                        |

### 11.2 集成测试

| 用例                                       | 预期                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| bootstrap 后 DB 存在 3 条 builtin schedule | enabled=true                                            |
| `POST /tick` dryRun                        | 返回 due 数量，无执行                                   |
| heartbeat 任务 rearm 后杀进程再 tick       | `runHeartbeatTick` 被调用                               |
| schedule 模式 Task 每天 9:00               | 1 分钟 tick + `tasks.lastHeartbeatAt` + isExecutionTime |
| memory 多页用户                            | messages 链式 3 页后 cursor 仍正确                      |
| 迁移期双跑                                 | 仅一套 cron 生效，无重复提取                            |

---

## 13. 风险与缓解（Phase 2+）

| 风险                      | 缓解                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| 外部 cron 未配置          | `last_executed_at` 超 2h 告警；健康检查脚本                               |
| tick 执行时间过长         | schedule/message limits；dispatch `maxTasksPerTick`；memory messages 分页 |
| 多实例重复 tick           | LockProvider 全局锁；`tick_lock_held` 返回 200                            |
| 迁移期双跑                | §7.5 切换清单；旧 cron 显式下线                                           |
| message 僵死              | §5.5 租约回收                                                             |
| heartbeat `<60s` 精度下降 | §8.4 Local + DB 双写                                                      |
| Vercel maxDuration        | 禁止同步全量扫描；仅 messages 链式                                        |
| builtin 被误删            | bootstrap upsert；API 禁止删 builtin                                      |
| `agent_cron_jobs` 误解    | §3.2 文档与产品说明                                                       |

---

## 14. 验收标准（Phase 2+）

> MVP 首期验收见 **§2.10**。

- [ ] `rg '@upstash/qstash' packages/internal-scheduler` 为 0
- [ ] 生产 **单 tick** QSchedule job 合并 dispatch /memory/watchdog（相对 MVP 三 job）
- [ ] 重启后 heartbeat message 继续投递；`<60s` 间隔仍有 Local 触发
- [ ] memory.hourly 全量用户可通过 messages 链在 24h 内扫完（压测记录）
- [ ] schedule-dispatch /watchdog/memory 均经 Manager；旧 cron 已停
- [ ] `NODE_ENV=test` 不初始化 scheduler；`DISABLE_INTERNAL_SCHEDULER=1` 可关
- [ ] `bunx vitest run packages/internal-scheduler` 通过
- [ ] `bun run type-check` 通过

---

## 附录 A：API 对照速查

```typescript
// ── QStash（旧）──
import { Client } from '@upstash/qstash';
const client = new Client({ token: process.env.ZXQSTASH_TOKEN! });

await client.schedules.create({
  scheduleId: 'my-schedule',
  destination: 'https://app.example.com/api/cron',
  cron: '0 * * * *',
});

await client.publishJSON({
  url: 'https://app.example.com/api/heartbeat',
  body: { taskId, userId },
  delay: 30,
});

// ── Internal Scheduler（新）──
import { getBootstrappedScheduler } from '@lobechat/internal-scheduler/integration';
const scheduler = getBootstrappedScheduler();

await scheduler.schedules.create({
  scheduleId: 'my-schedule',
  handlerKey: 'my.handler',
  cron: '0 * * * *',
});

await scheduler.messages.publish({
  handlerKey: 'task.heartbeat-tick',
  body: { taskId, userId },
  delaySeconds: 30,
});

// QSchedule jobWorker 或本地 curl 触发
await scheduler.tick();
```

---

## 附录 B：文件清单

**MVP（当前实施）** 见 **§2.11**。

**Phase 2+ 完整版（暂缓）**：

| 路径                                                             | 操作                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/internal-scheduler/**`                                 | 新增                                                                   |
| `packages/database/src/schemas/internalScheduler.ts`             | 新增                                                                   |
| `packages/database/src/models/internalScheduler.ts`              | 新增（Repository + LockProvider）                                      |
| `packages/database/package.json`                                 | 增加 exports（如 `./internal-scheduler`）                              |
| `packages/internal-scheduler/qschedule/tick-job.cjs`             | 新增（QSchedule jobWorker，随包发布）                                  |
| `packages/internal-scheduler/src/integration/**`                 | 新增（bootstrap /http/qschedule）                                      |
| `packages/internal-scheduler/src/helpers/**`                     | 新增（chainedPage /heartbeat）                                         |
| `packages/internal-scheduler/src/presets/calcifer.ts`            | 新增（builtin schedules）                                              |
| `package.json`（根）                                             | 增加 `@lobechat/internal-scheduler`；`@ctrip/vampire-schedule` 作 peer |
| `packages/database/migrations/0xxx_*.sql`                        | 新增                                                                   |
| `src/server/scheduler/handlers.ts`                               | 新增（\~30 行，仅业务 handler）                                        |
| `src/server/workflows-hono/scheduler/index.ts`                   | 新增（\~8 行薄转发）                                                   |
| `src/app/(backend)/api/internal/scheduler/[[...route]]/route.ts` | 新增（挂载）                                                           |
| `src/instrumentation.node.ts`                                    | 修改（+\~10 行）                                                       |
| `src/server/workflows-hono/memory/handlers/hourly.ts`            | Phase 1 删除 fetch 自链                                                |
| `src/server/services/taskLifecycle/index.ts`                     | Phase 2 改 1 行 `rearmHeartbeatMessage`                                |
| ~~`src/server/scheduler/bootstrap.ts`~~                          | **删除**（由 integration 替代）                                        |
| ~~`src/server/scheduler/schedules/**`~~                          | **删除**（QSchedule 逻辑进 manager）                                   |
| `src/server/workflows-hono/task/handlers/scheduleDispatch.ts`    | 抽取 `*Core`                                                           |
| `src/server/workflows-hono/task/handlers/watchdog.ts`            | 抽取 `*Core`                                                           |
| `docs/specs/remove-upstash-qstash-migration.md`                  | 追加引用本 SPEC                                                        |
| `calcifer.env`                                                   | 补充 `DISABLE_INTERNAL_SCHEDULER` 说明                                 |

---

## 附录 C

已并入 **§2 MVP 实施方案（已确认）**；本节保留为空，避免重复维护。

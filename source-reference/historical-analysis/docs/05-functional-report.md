# 阶段 5 · 接口与功能测试报告

> 进行中。环境：完全离线（PGlite + Mock LLM + Mock Services + 8 个 `@ctrip/*` 存根，无 Redis）。
> 基线 `main` @ `94dd700` + 本分支离线改造。

## 分层进度

| 层级 | 范围 | 状态 |
| --- | --- | --- |
| L1 单元 | 仓库既有 Vitest 套件 | ✅ 已跑，见 §1 |
| L2 服务集成 | PGlite + 真实 service | ⬜ 待做 |
| L3 HTTP 契约 | `tools/api-test/` | 🟡 冒烟已通（27/27），其余脚本待写 |
| L4 端到端 | Cucumber + Playwright | ⬜ 待做 |

---

## 1. L1 单元测试结果

> 注意：根 `vitest.config.mts` 的 `exclude` 含 `**/packages/**`，各包必须**进入包目录**单独运行。
> 另外 `packages/debug` 强制开启 `lobe-*` 命名空间且无法用 `DEBUG` 环境变量关闭，测试输出会被调试日志淹没 —— 需重定向到文件再提取摘要。

| 范围 | 测试文件 | 用例 | 结果 |
| --- | --- | --- | --- |
| `packages/agent-runtime` | 9 | 257 | ⚠️ **253 通过 / 4 失败** |
| `src/server/modules/AgentRuntime` + `src/server/services/agentRuntime` | 13 | 271 | ✅ 全通过 |
| `packages/context-engine` | 49 | 696 | ✅ 全通过 |
| `packages/eval-rubric` | 12 | 73 | ✅ 全通过 |
| `packages/eval-dataset-parser` | 2 | 16 | ✅ 全通过 |
| `packages/agent-manager-runtime` | 1 | 20 | ✅ 全通过 |
| `packages/builtin-tools` | 1 | 4 | ✅ 全通过 |
| `packages/conversation-flow` | 8 | — | ⚠️ **1 文件失败** |
| `packages/prompts` | 51 | — | ⚠️ **1 文件失败** |
| `packages/builtin-agents` | 0 | — | ⬜ 无测试文件 |
| **合计（已统计部分）** | **146+** | **1337+** | — |

服务端 agent 运行时逐文件明细（全绿）：

```
✓ AgentStateManager.test.ts              5
✓ StreamEventManager.test.ts             4
✓ InMemoryStreamEventManager.test.ts     7
✓ factory.test.ts                        8
✓ AgentRuntimeCoordinator.test.ts       19
✓ InMemoryAgentStateManager.test.ts     38
✓ HookDispatcher.test.ts                21
✓ executeStep.test.ts                   19
✓ RuntimeExecutors.test.ts              64
✓ completionWebhook.test.ts              6
✓ stepLifecycleCallbacks.test.ts        14
✓ executeSync.test.ts                   12
✓ AgentRuntimeService.test.ts           54
```

### 1.1 既有失败：`agent-runtime` 的 tokenCounter（4 个）

**全部是仓库既有失败，与离线改造无关** —— `tokenCounter.ts` 与 `tokenCounter.test.ts` 都停在初始提交 `94dd700`，本分支未改动。

失败项：

```
× getCompressionThreshold > should use default values        expected 83200 to be 64000
× getCompressionThreshold > should use custom maxWindowToken expected 130000 to be 100000
× shouldCompress > 未超阈值时 needsCompression=false          expected 83200 to be 64000
× shouldCompress > 超阈值时 needsCompression=true             expected false to be true
```

**根因**：源码 `DEFAULT_THRESHOLD_RATIO = 0.65`（`tokenCounter.ts:17`），测试却写死 `64_000` 并注释 `// 128k * 0.5`。比例从 0.5 调到 0.65 后，硬编码的期望值没同步。

同一个测试里用常量推导的断言（`:111` `Math.floor(DEFAULT_MAX_CONTEXT * DEFAULT_THRESHOLD_RATIO)`）是通过的，只有写死数字的那行挂 —— 典型的"改了实现忘了改测试里的魔数"。

**对后续阶段的影响**：**上下文压缩的实际触发点是上下文窗口的 65%，不是 50%。**
128k 窗口下阈值是 **83,200** tokens 而非 64,000。阶段 6 设计 `long-context` 场景、估算压缩触发频率时必须按 65% 算，否则会低估压缩发生的门槛。

对应功能点 **F7.13（上下文压缩，P0）**。

### 1.2 既有失败：`conversation-flow` 与 `prompts`（各 1 文件）

同样都停在 `94dd700`，本分支未改动，属既有失败。

| 包 | 文件 | 失败用例 |
| --- | --- | --- |
| `conversation-flow` | `src/__tests__/parse.test.ts` | `parse > Tool Usage > should parse assistant with tools correctly` —— 对象深比较不等 |
| `prompts` | `src/chains/__tests__/summaryDescription.test.ts` | `chainSummaryDescription > should return a payload with the correct...` —— 12 条 messages 的深比较不等 |

两者都是 deep-equal 断言差异，尚未展开定位到具体字段。**未列为阻塞**，但说明主干上存在未修复的失败测试。

---

## 2. L3 HTTP 契约测试

### 2.1 冒烟（已完成）

`tools/api-test/smoke.ts` —— **27 项断言全通过**，覆盖 PLAN.md 检查点 5–10。

链路：`getBuiltinAgent → createTopic → sendMessageInServer → createOperation → SSE → agent_runtime_end`

| 场景 | 事件数 | 状态 | 步数 | tokens |
| --- | --- | --- | --- | --- |
| `simple`（纯文本） | 11 | done | 1 | 66 |
| `single-tool`（工具） | 20 | done | 3 | 181 |

实测确认的 SSE 事件词汇（**与内部 `AgentEvent` 联合类型不同**）：

```
connected · agent_runtime_init · step_start · stream_start · stream_chunk
stream_end · step_complete · tool_start · tool_end · agent_runtime_end · heartbeat
```

### 2.2 F2 生命周期（`agent-lifecycle.ts`）—— 17 通过 / 5 失败

| 功能点 | 结果 |
| --- | --- |
| F2.1 createOperation 返回值与 operationId 规范 | ✅ |
| F2.2 `autoStart` 真假两条路径 | ✅ |
| F2.5 手动 `startExecution` → done | ✅ |
| F2.3/F2.12 状态查询字段（status/stepCount/usage/stats/isCompleted/executionHistory） | ✅（`cost` 字段缺失，见下） |
| **F2.8 maxSteps → forceFinish** | ❌ **不成立，见附录 B** |
| **F2.9 costLimit 熔断** | ❌ **API 未暴露，无法设置** |
| **F2.10 中断** | ❌ **`interruptTask` 无效** |

**次要问题**：`currentState` 里没有 `cost` 字段（`usage` 有，`stats.totalCost` 也有）。
`OperationStatusResult` 类型声明里有 `cost?: any`，实际未返回 —— 疑似 cost 为 0 时被省略。
影响：调用方拿不到成本明细（`byModel` 分项），只能拿到 `stats.totalCost` 汇总值。

### 2.3 🔴🔴 最严重发现：Agent 循环失控

跑 F2.8 时发现 agent 会**无限循环**：1 分钟 173 万 tokens、186 次 LLM 调用、5.9 步/秒线性增长，
`interruptTask` 返回成功但停不下来，状态永远显示 `idle`。

完整分析见 **[PLAN.md 附录 B](../../PLAN.md)**，含三个独立缺陷（无默认步数上限 /
中断的丢失更新竞态 / 状态机不进入 `running`）、按真实 provider 的成本换算、以及修复建议。

### 2.4 待写脚本

`sse.ts` · `hil.ts` · `tools-matrix.ts` · `openapi-contract.ts`

---

## 3. 累计发现的缺陷

按发现顺序，均已同步进 [PLAN.md](../../PLAN.md) 附录 A。

| # | 级别 | 缺陷 | 位置 |
| --- | --- | --- | --- |
| 0 | 🔴🔴 | **Agent 循环无上限且中断无效** —— 实测 1 分钟 173 万 tokens 线性增长，`interruptTask` 停不下来，状态永远 `idle`。见 [PLAN.md 附录 B](../../PLAN.md) | `aiAgent.ts:23-37`、`runtime.ts:91-100`、`AgentRuntimeService.ts:265-281` |
| 1 | 🔴 | 本地无 Redis 模式下 **SSE 事件投递静默失效** —— agent 正常跑完并落库，客户端只收到 `connected`+`heartbeat`，无任何报错 | `factory.ts:56-70`、`InMemoryStreamEventManager.ts` |
| 2 | 🔴 | `InMemoryAgentStateManager.tryClaimStep()` **恒返回 true** —— 本地模式完全没有步锁，429 + `Retry-After` 防重入形同虚设 | `InMemoryAgentStateManager.ts:218-224` |
| 3 | 🔴 | 飞书 `appSecret` **硬编码在浏览器侧代码**，随 SPA bundle 分发 | `src/services/feishuToken.ts:70-75` |
| 4 | 🟡 | 鉴权失败返回 **500 而非 401**（`onError` 吞掉 `HTTPException`） | `packages/openapi/src/app.ts:21-24` |
| 5 | 🟡 | `dev:spa:mobile` **不加载移动端入口**，dev 下是「桌面路由 + 移动编译标志」的混合态 | `vite.config.ts:29,33` |
| 6 | 🟡 | `dev:desktop` 在全新 checkout 上跑不起来 —— `apps/cli` / `apps/desktop` 不在根 workspace | `pnpm-workspace.yaml` |
| 7 | 🔴 | 桌面端 **默认指向携程线上**（`.env.desktop.test` 写死 `calcifer.train.ctripcorp.com`） | `.env.desktop.test:17-18` |
| 8 | 🟡 | S3 是**聊天主链路的硬依赖** —— 不配则 `sendMessageInServer` 直接 500 | `src/server/modules/S3/index.ts:45` |
| 9 | 🟡 | `pnpm-workspace.yaml` 的 `overrides` / `onlyBuiltDependencies` **长期未生效**（被 `package.json` 的 `pnpm.*` 覆盖） | `pnpm-workspace.yaml` |
| 10 | 🟡 | **4 个既有失败测试** —— 压缩阈值魔数未随 `DEFAULT_THRESHOLD_RATIO` 0.5→0.65 更新 | `tokenCounter.test.ts:112,117` |
| 11 | 🟢 | `conversation-flow` / `prompts` 各有 1 个既有失败测试文件 | 见 §1.2 |

---

## 4. 未验证项

与 PLAN.md「待将来补测清单」互补，此处记录**测试手段限制**导致的未验证项（非环境限制）。

| 项 | 原因 |
| --- | --- |
| 移动端 UI 驱动完成一次对话（F17.4） | 合成键盘事件进不到富文本编辑器的提交处理器 |
| 桌面端 `local-system` 读写本地文件（F16.4、F5.8） | 无法从当前会话驱动独立的 Electron 应用窗口；需人工操作或引入 Playwright 的 Electron 驱动 |

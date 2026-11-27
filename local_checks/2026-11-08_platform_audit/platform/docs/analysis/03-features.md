# 阶段 3 · 功能点拆解

> 只读静态分析。基线 `main` @ `94dd700`。
> 本清单是**阶段 5（接口与功能测试）的输入**：每个功能点都给出可直接调用的入口。

## 统计

| 组 | 主题 | 功能点数 | P0 | P1 | P2 |
| --- | --- | --- | --- | --- | --- |
| F1 | 会话与消息 | 8 | 5 | 3 | 0 |
| F2 | Agent 生命周期与状态机 | 12 | 9 | 3 | 0 |
| F3 | 流式输出（SSE） | 8 | 6 | 2 | 0 |
| F4 | 工具调用与路由 | 10 | 6 | 4 | 0 |
| F5 | 内置工具能力 | 21 | 3 | 13 | 5 |
| F6 | 人在环（HIL） | 9 | 6 | 3 | 0 |
| F7 | 上下文工程 | 14 | 4 | 10 | 0 |
| F8 | 子任务与异步编排 | 8 | 2 | 6 | 0 |
| F9 | 群体编排 | 9 | 0 | 7 | 2 |
| F10 | 模型接入 | 8 | 3 | 5 | 0 |
| F11 | 对外 API 与权限 | 9 | 4 | 5 | 0 |
| F12 | 双运行时一致性 | 6 | 2 | 4 | 0 |
| F13 | 接入通道 | 6 | 0 | 2 | 4 |
| F14 | 评测体系 | 6 | 0 | 2 | 4 |
| F15 | 可观测性 | 6 | 1 | 4 | 1 |
| F16 | 桌面端（Electron） | 12 | 3 | 7 | 2 |
| F17 | 移动端 | 6 | 1 | 4 | 1 |
| **合计** | | **158** | **55** | **84** | **19** |

> F16 / F17 于 2026-08-07 按「覆盖桌面端与移动端」的决策新增。

优先级定义：`P0` = 核心链路，不通则项目不可用；`P1` = 重要能力，影响主要场景；`P2` = 增强/边缘。

---

## F1 会话与消息（8）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F1.1 | 发消息落库：创建 topic/thread/preload/user/assistant 五类消息并返回最新列表 | tRPC `aiChat.sendMessageInServer` | P0 |
| F1.2 | assistant 消息占位（`content = LOADING_FLAT`）后续被流式内容覆盖 | 同上 + `RuntimeExecutors.call_llm` | P0 |
| F1.3 | 结构化输出（JSON Schema 约束） | tRPC `aiChat.outputJSON` → `modelRuntime.generateObject` | P1 |
| F1.4 | topic CRUD + 分享（`enableSharing`/`disableSharing`/`updateShareVisibility`） | tRPC `topic.*`、`/api/v1/topics` | P0 |
| F1.5 | message CRUD + 批量删除（按 assistant / group / query） | tRPC `message.*`、`/api/v1/messages` | P0 |
| F1.6 | 分支线程（thread）创建与查询 | tRPC `thread.*` | P1 |
| F1.7 | 消息翻译（触发 LLM） | `/api/v1/message-translations/:messageId` | P1 |
| F1.8 | 消息压缩组（`createCompressionGroup` / `finalizeCompression` / `cancelCompression`） | tRPC `message.*` | P0 |

## F2 Agent 生命周期与状态机（12）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F2.1 | 创建 operation：ID 格式 `agt_{ts}_{agentId}_{topicId}_{nanoid8}`，冻结 OperationToolSet，写 Redis + `agent_operations` 行 | tRPC `aiAgent.createOperation` | P0 |
| F2.2 | `autoStart=true` 自动调度第 0 步；`autoStart=false` 不调度 | 同上 + `aiAgent.startExecution` | P0 |
| F2.3 | 单步执行：加载 state → 跑 `runtime.step` → 保存 → 决定是否调度下一步 | `AgentRuntimeService.executeStep` | P0 |
| F2.4 | **步锁**：同 `(operationId, stepIndex)` 并发只有一个成功，另一个 `{locked:true}` → HTTP 429 + `Retry-After: 37`　✅ **已于 2026-08-08 实测通过**（条件：真 Redis **且** `AGENT_RUNTIME_MODE=queue`）—— 并发同一步恰好 1×200 + 1×429 且 `Retry-After: 37`，步完成后锁释放可重认领。⚠️ **非 queue 模式仍无锁**：`InMemoryAgentStateManager.tryClaimStep()` 恒返回 `true`（空实现，`:218-224`），该结论不变 | `AgentStateManager.tryClaimStep`（`SET NX EX 35`）、`run/route.ts:80-91` | P0 |
| F2.5 | 状态机 7 态流转正确（`idle/running/waiting_for_human/waiting_for_async_tool/done/error/interrupted`） | `AgentState.status` | P0 |
| F2.6 | 指令数组执行中遇 blocked 状态立即 break | `runtime.ts:199-202` + `isBlockedStatus` | P0 |
| F2.7 | `finish` 指令不计入 stepCount（撤销 +1） | `runtime.ts:210-212` | P1 |
| F2.8 | `maxSteps` 超限 → `forceFinish=true`（不报错），下次 LLM 调用剥离工具 + 注入收尾 prompt | `runtime.ts:91-100`、`ForceFinishSummaryInjector` | P0 |
| F2.9 | `costLimit` 超限 → 停止（`onExceeded !== 'stop'` 时继续） | `AgentRuntimeService.ts:2214` | P0 |
| F2.10 | 中断：`status='interrupted'` + `interruption{reason, interruptedAt, canResume}` | tRPC `aiAgent.interruptTask` → `runtime.interrupt()` | P0 |
| F2.11 | 终态事件 `agent_runtime_end` **只发一次**（`hasEnteredTerminalState` 去重） | `AgentRuntimeCoordinator.ts:12-18,93-101,120-132` | P0 |
| F2.12 | 状态查询返回完整快照（status/stepCount/cost/usage/pending*/stats/history/events） | tRPC `aiAgent.getOperationStatus` | P1 |

## F3 流式输出（SSE）（8）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F3.1 | 建连即发 `connection` 事件 | `GET /api/agent/stream` | P0 |
| F3.2 | 缺 `operationId` → 400 | 同上 | P0 |
| F3.3 | `includeHistory=true` 补发最近 50 条历史，按时间正序，过滤 `> lastEventId` | `stream/route.ts:61-98` | P1 |
| F3.4 | `lastEventId` 断点续传：重连不重复、不丢事件 | 同上 | P0 |
| F3.5 | 30s 心跳；`streamEnded` 后不再发心跳 | `stream/route.ts:108-126` | P1 |
| F3.6 | 收到 `agent_runtime_end` 立即 `cleanup()` + `controller.close()`，且后续事件全部丢弃 | `stream/route.ts:174-189` | P0 |
| F3.7 | 文本 / reasoning 双缓冲 flush：内容完整、顺序正确、无丢字 | `RuntimeExecutors.ts` call_llm 的 `flushTextBuffer`/`flushReasoningBuffer` | P0 |
| F3.8 | 客户端断连时服务端订阅被 abort（但 agent 循环继续） | `stream/route.ts` `cancel()` + `request.signal` | P0 |

## F4 工具调用与路由（10）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F4.1 | 单工具调用 → `tool_result` → 回灌 LLM（phase `tool_result`） | `RuntimeExecutors.call_tool:959` | P0 |
| F4.2 | 批量并行工具（`p-map`），总耗时 < 串行和 | `runtime.executeToolsBatch` / `RuntimeExecutors.call_tools_batch:1247` | P0 |
| F4.3 | 工具路由：`toolSourceMap` 分发到 builtin / plugin / mcp / klavis / lobehubSkill 五类 | `OperationToolSet.sourceMap` | P0 |
| F4.4 | 旧格式 `call_tools_batch`（payload 为 `ToolsCalling[]`）自动归一化为新格式 | `runtime.ts:134-156` | P1 |
| F4.5 | 工具参数修复（LLM 产出非法 JSON 时） | `context-engine/engine/tools/ToolArgumentsRepairer.ts` | P1 |
| F4.6 | 工具名解析与冲突消解 | `ToolNameResolver.ts` | P1 |
| F4.7 | 渐进式工具激活 `activateTools`，写入 `state.activatedStepTools`，重复激活被短路 | `builtin-tool-activator` / `builtin-tool-tools` | P1 |
| F4.8 | 工具执行失败 → 错误作为 tool result 回灌，循环不中断 | `RuntimeExecutors` catch 分支 | P0 |
| F4.9 | 中止时未完成的工具被 `resolve_aborted_tools` 收尾 | `RuntimeExecutors:1653` | P0 |
| F4.10 | `alwaysOnToolIds`（activator/skills/skill-store/lobe-agent）无视用户选择恒启用 | `packages/builtin-tools/src/index.ts` | P1 |

## F5 内置工具能力（21 个包，约 100 个 API）

> 每个包一个功能点；包内每个 API 作为该功能点下的子用例。

| ID | 包 | API 列表 | 优先级 |
| --- | --- | --- | --- |
| F5.1 | `builtin-tool-lobe-agent` | `createPlan, updatePlan, createTodos, updateTodos, clearTodos, execTask, execTasks, callSubAgent, analyzeVisualMedia` | P0 |
| F5.2 | `builtin-tool-activator` | `activateTools` | P0 |
| F5.3 | `builtin-tool-skills` | `activateSkill, readReference, exportFile, runCommand, execScript` | P0 |
| F5.4 | `builtin-tool-task` | `createTask, createTasks, listTasks, viewTask, addTaskComment, updateTaskComment, deleteTaskComment, editTask, runTask, runTasks, setTaskSchedule, updateTaskStatus, deleteTask` | P1 |
| F5.5 | `builtin-tool-web-browsing` | `search, crawlSinglePage, crawlMultiPages` | P1 |
| F5.6 | `builtin-tool-memory` | `searchUserMemory, addContextMemory, addActivityMemory, addExperienceMemory, addIdentityMemory, addPreferenceMemory, updateIdentityMemory, removeIdentityMemory` | P1 |
| F5.7 | `builtin-tool-knowledge-base` | `searchKnowledgeBase, readKnowledge` | P1 |
| F5.8 | `builtin-tool-local-system`（桌面） | `listLocalFiles, readLocalFile, searchLocalFiles, moveLocalFiles, renameLocalFile, writeLocalFile, editLocalFile, runCommand, getCommandOutput, killCommand, grepContent, globLocalFiles` | P1 |
| F5.9 | `builtin-tool-cloud-sandbox` | 同 F5.8 + `executeCode, exportFile` | P1 |
| F5.10 | `builtin-tool-agent-builder` | `getAvailableModels, searchMarketTools, installPlugin, updateAgentConfig, updatePrompt` | P1 |
| F5.11 | `builtin-tool-agent-documents` | `createDocument, readDocument, editDocument, removeDocument, renameDocument, copyDocument, updateLoadRule` | P1 |
| F5.12 | `builtin-tool-notebook` | `createDocument, updateDocument, getDocument, deleteDocument` | P1 |
| F5.13 | `builtin-tool-topic-reference` | `getTopicContext` | P1 |
| F5.14 | `builtin-tool-skill-store` | `searchSkill, importFromMarket, importSkill` | P1 |
| F5.15 | `builtin-tool-brief` | `createBrief, requestCheckpoint` | P1 |
| F5.16 | `builtin-tool-remote-device` | `listOnlineDevices, activateDevice` | P2 |
| F5.17 | `builtin-tool-group-management` | `speak, broadcast, delegate, executeAgentTask, executeAgentTasks, interrupt, summarize, createWorkflow, vote` | P1 |
| F5.18 | `builtin-tool-group-agent-builder` | 群体 agent 构建 | P2 |
| F5.19 | `builtin-tool-agent-management` | agent 管理 | P2 |
| F5.20 | `builtin-tool-page-agent` | 页面编辑器 agent 工具 | P2 |
| F5.21 | `builtin-tool-calculator` | 计算 | P2 |
| — | `builtin-tool-tools` | `activateTools`（与 F5.2 同名，需确认二者关系） | — |

## F6 人在环（HIL）（9）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F6.1 | 需审批工具被拦截 → `status='waiting_for_human'` + `pendingToolsCalling` + `human_approve_required` 事件 | `GeneralChatAgent` + `RuntimeExecutors:1594` | P0 |
| F6.2 | approve 后从 `phase='human_approved_tool'` 直接合成 `call_tool`（跳过 `agent.runner`） | `runtime.ts:109-124` | P0 |
| F6.3 | reject + `rejectionReason` → 工具不执行，理由回灌 | `aiAgent.processHumanIntervention({action:'reject'})` | P0 |
| F6.4 | `request_human_prompt`：`pendingHumanPrompt` + 事件；`action:'input'` 回填续跑 | `GeneralChatAgent` | P1 |
| F6.5 | `request_human_select`：单选 / 多选（`multi`）；`action:'select'` 回填 | 同上 | P1 |
| F6.6 | **安全黑名单强制拦截**：即使 auto-run/headless 也拦 | `packages/agent-runtime/src/audit/` | P0 |
| F6.7 | 混合场景：一批工具中免审的先执行、需审的再请求（`[call_tools_batch, request_human_approve]`） | `GeneralChatAgent` 类注释 | P0 |
| F6.8 | 策略解析优先级：API 级 > 工具级；支持 `'always'` / 规则数组（`match` 参数匹配 + `*` 通配）/ `dynamic` resolver | `GeneralChatAgent.ts:50-115` | P0 |
| F6.9 | `getPendingInterventions` 按 operationId 或 userId 聚合，返回 `type` 三分类 | tRPC `aiAgent.getPendingInterventions` | P1 |

## F7 上下文工程（14）

| ID | 功能点 | 组件 | 优先级 |
| --- | --- | --- | --- |
| F7.1 | 历史截断（必须是流水线第一个） | `HistoryTruncateProcessor` | P0 |
| F7.2 | systemRole 注入 | `SystemRoleInjector` | P0 |
| F7.3 | 系统日期 + 时区注入 | `SystemDateProvider` | P1 |
| F7.4 | 用户记忆（persona）注入 | `UserMemoryInjector` | P1 |
| F7.5 | 知识库注入 + agent 文档注入 | `KnowledgeInjector` / `AgentDocumentInjector` | P1 |
| F7.6 | 技能上下文 + 已选技能注入 | `SkillContextProvider` / `SelectedSkillInjector` | P1 |
| F7.7 | 工具发现 + 工具 systemRole | `ToolDiscoveryProvider` / `ToolSystemRoleProvider` | P1 |
| F7.8 | GTD Plan / Todo 注入 | `GTDPlanInjector` / `GTDTodoInjector` | P1 |
| F7.9 | 页面选区 + 页面编辑器上下文 | `PageSelectionsInjector` / `PageEditorContextInjector` | P1 |
| F7.10 | 话题引用上下文 | `TopicReferenceContextInjector` + `resolveTopicReferences` | P1 |
| F7.11 | 输入模板 + 占位符变量渲染 | `InputTemplateProcessor` / `PlaceholderVariablesProcessor` | P1 |
| F7.12 | 工具消息重排 + 消息清理（保证 OpenAI 消息序列合法） | `ToolMessageReorder` / `MessageCleanupProcessor` | P0 |
| F7.13 | **上下文压缩**：`shouldCompress` 触发 → `compress_context` → 压缩模型调用 → `compression_complete` + MessageGroup 摘要；支持增量摘要（`existingSummary`） | `utils/tokenCounter.ts`、`RuntimeExecutors:711` | P0 |
| F7.14 | `forceFinish` 收尾 prompt 注入 | `ForceFinishSummaryInjector` | P0 |

## F8 子任务与异步编排（8）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F8.1 | `exec_task` 单任务（**仅客户端 executor 实现**） | `createAgentExecutors.ts:1398` | P1 |
| F8.2 | `exec_tasks` 并行任务 | `createAgentExecutors.ts:1810` | P1 |
| F8.3 | `exec_client_task` / `exec_client_tasks` 桌面端本地执行（非桌面平台忽略 `runInClient`） | `createAgentExecutors.ts:2106,2463` | P2 |
| F8.4 | 服务端 Brain 产出 `exec_task` 时会抛 `No executor found` —— 需确认服务端是否会走到该分支 | `runtime.ts:182` | P0 |
| F8.5 | `callSubAgent`：派生 child operation（`isSubAgent=true`, `parentOperationId`），父置 `waiting_for_async_tool` + 占位 tool 消息 | `builtin-tool-lobe-agent` + `AgentRuntimeService` | P1 |
| F8.6 | `completeSubAgentBridge`：child 终态后回填父占位消息并恢复父 | `AgentRuntimeService.ts:1733` | P1 |
| F8.7 | `verifyAsyncToolBarrier` + `asyncToolVerifyAttempt` 有界退避重试 | `services/agentRuntime/types.ts:113-124` | P1 |
| F8.8 | 拒绝嵌套子 agent（`appContext.isSubAgent` 为真时不允许再派发） | `OperationCreationParams.appContext` | P1 |

## F9 群体编排（9）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F9.1 | Supervisor 决定下一个发言者 / 收敛条件 | `GroupOrchestrationSupervisor.ts` | P1 |
| F9.2 | `speak` / `broadcast` | `builtin-tool-group-management` | P1 |
| F9.3 | `delegate` 委派 | 同上 | P1 |
| F9.4 | `executeAgentTask` / `executeAgentTasks` | 同上 + tRPC `aiAgent.execGroupAgent` | P1 |
| F9.5 | `vote` 投票 | 同上 | P2 |
| F9.6 | `summarize` 汇总 | 同上 | P1 |
| F9.7 | `interrupt` 群体中断 | 同上 | P1 |
| F9.8 | `createWorkflow` | 同上 | P2 |
| F9.9 | 群消息角色转换与还原（进 LLM 前 flatten，出来后 restore） | `GroupRoleTransform` / `SupervisorRoleRestore` / `GroupMessageFlatten` / `GroupOrchestrationFilter` / `AgentCouncilFlatten` | P1 |

## F10 模型接入（8）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F10.1 | 主用 provider 流式调用（至少覆盖测试环境实际使用的 provider） | `packages/model-runtime/src/providers/*` | P0 |
| F10.2 | `stream: false` 非流式路径（bot 集成、OpenResponses 同步） | `OperationCreationParams.stream` | P1 |
| F10.3 | usage 归一化与累加（含 `inputCachedTokens` / `inputCacheMissTokens` / `inputWriteCacheTokens` / `inputTextTokens` / `inputImageTokens` 等） | `UsageCounter.mergeModelUsage` | P0 |
| F10.4 | cost 计算（按 `model-bank` 定价，`byModel` 明细，币种 USD） | `UsageCounter` + `Cost` 类型 | P0 |
| F10.5 | provider 错误归一化与错误类型抽取 | `RuntimeExecutors.ts:56-90` | P1 |
| F10.6 | KeyVaults 加解密（provider 密钥） | `src/server/modules/KeyVaultsEncrypt` | P1 |
| F10.7 | provider 连通性检查 | tRPC `aiProvider.checkProviderConnectivity` | P1 |
| F10.8 | 模型列表拉取 / 远程模型清理 | tRPC `aiModel.getAiProviderModelList` / `clearRemoteModels` | P1 |

## F11 对外 API 与权限（9）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F11.1 | API Key 鉴权（`sk-lh-{16}` 格式校验 + DB 查询） | `openapi/middleware/auth.ts` | P0 |
| F11.2 | ~~API Key 内存缓存 5 分钟（**吊销延迟**需实测确认）~~ → ✅ **已处置**（2026-08-09，PLAN §23.3）：TTL 降到 **60 秒**作地板 + Redis pub/sub 跨实例失效（已实测端到端打通）。缓存是**进程内 Map**，多实例下不广播就清不掉别的实例 | `auth.ts`、`src/server/services/apiKeyCacheBus.ts` | P1 |
| F11.3 | OIDC JWT 鉴权 | `validateOIDCJWT` | P0 |
| F11.4 | RBAC 权限拒绝路径（无权限返回明确 message） | `requireAnyPermission` | P0 |
| F11.5 | **开发态旁路仅在 `NODE_ENV=development` 生效**（生产必须 401） | 3 处入口 | P0 |
| F11.6 | `POST /api/v1/responses` 非流式：`executeSync` 跑完并返回完整 `ResponseObject` | `responses.service.ts:189-266` | P1 |
| F11.7 | `POST /api/v1/responses` 流式：SSE 事件转换为 OpenResponses 协议事件 | `responses.service.ts:createStreamingResponse` | P1 |
| F11.8 | `previous_response_id` → topicId 解码，支持多轮 | `extractTopicIdFromResponseId` | P1 |
| F11.9 | 分页参数校验与响应结构（`PaginationQuerySchema` / `PaginationQueryResponse`） | `openapi/helpers/pagination.ts` | P1 |

## F12 双运行时一致性（6）

> 服务端与客户端共用 Brain + Engine，但 executor 是两套实现，行为一致性必须单独验证。

| ID | 功能点 | 断言点 | 优先级 |
| --- | --- | --- | --- |
| F12.1 | 同一输入下，两套 executor 产出的消息序列等价 | 对比 `RuntimeExecutors` 与 `createAgentExecutors` 的 call_llm 输出 | P0 |
| F12.2 | 压缩行为一致（阈值、摘要格式、MessageGroup 结构） | 两处 `compress_context` 实现 | P1 |
| F12.3 | HIL 拦截判定一致（共用 `InterventionChecker`，应天然一致） | `GeneralChatAgent` | P0 |
| F12.4 | usage / cost 累加一致 | 共用 `UsageCounter` | P1 |
| F12.5 | 中止语义一致（`abortController` 来源不同） | `getOperation()` 两处实现 | P1 |
| F12.6 | 客户端 `maxSteps=1000` vs 服务端可配 —— 差异是否有意为之 | `streamingExecutor.ts:478` | P1 |

## F13 接入通道（6）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F13.1 | Bot webhook 分发（platform + 可选 appId） | `/api/agent/webhooks/[platform]/[[...appId]]` | P1 |
| F13.2 | 飞书 Bot 适配（当前唯一已实现平台） | `src/server/services/bot/platforms/feishu` | P1 |
| F13.3 | Bot 回复回调 + 附件转发（`HookEventAttachment`） | `/api/agent/webhooks/bot-callback` + `hooks/types.ts` | P2 |
| F13.4 | Agent Gateway WebSocket 启动/重启 | `/api/agent/gateway/start` | P2 |
| F13.5 | 设备注册与远程设备工具 | tRPC `device.*`（31 procedure） | P2 |
| F13.6 | 定时任务（agent cron + platform-cron） | tRPC `agentCronJob.*`、`/api/internal/platform-cron` | P2 |

## F14 评测体系（6）

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F14.1 | 数据集解析（多格式探测 + parser） | `packages/eval-dataset-parser`（`detect.ts`/`parseDataset.ts`/`parsers/`） | P1 |
| F14.2 | rubric 评分（matchers + extractors + normalize） | `packages/eval-rubric` | P1 |
| F14.3 | benchmark 工作流编排（10 个 workflow route） | `/api/workflows/agent-eval-run/*` | P2 |
| F14.4 | trajectory 运行与恢复（agent / thread 两条轨迹） | `run-agent-trajectory` / `resume-agent-trajectory` 等 | P2 |
| F14.5 | 评测运行管理（start/abort/retry/progress/results） | tRPC `agentEval.*`（31 procedure） | P2 |
| F14.6 | 外部评测回报接口 | tRPC `agentEvalExternal.*`（10 procedure） | P2 |

## F15 可观测性（6）

| ID | 功能点 | 入口 / 断言点 | 优先级 |
| --- | --- | --- | --- |
| F15.1 | agent-tracing 分步快照落盘（`_partial/`）+ 终态固化（`{ts}_{traceId}.json` + `latest.json`） | `packages/agent-tracing/src/recorder` | P0 |
| F15.2 | `context_engine_result` 事件携带完整上下文引擎输入/输出 | `RuntimeExecutors` call_llm | P1 |
| F15.3 | CLI `agent-tracing inspect/list/partial`（`-s/-m/-t/-e/-c/-p`） | `packages/agent-tracing/src/cli` | P1 |
| F15.4 | step webhook / completion webhook 投递（`fetch` 与 `qstash` 两种 delivery） | `AgentRuntimeService.ts:2075,2133` | P1 |
| F15.5 | `AgentHook` 四个生命周期点（beforeStep/afterStep/onComplete/onError）本地与 webhook 双模 | `hooks/HookDispatcher.ts` | P1 |
| F15.6 | triplog trace context 注入（uid/model/provider） | `run/route.ts:51-63` | P2 |

## F16 桌面端 Electron（12）

> 代码位置：`apps/desktop/`（25 个 controller + 6 个 service）、`packages/electron-client-ipc`（9 组 IPC 事件）、`packages/electron-server-ipc`、`packages/desktop-bridge`、`packages/local-file-shell`。
> **这是唯一能真正验证 F5.8（`local-system` 12 个 API）和 F8.3（`exec_client_task`）的环境。**

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F16.1 | 应用启动：`bun run dev:desktop` 起 Electron 主进程 + 渲染进程 | `apps/desktop` `electron-vite dev` | P0 |
| F16.2 | 前置依赖就位：`apps/cli` 本地构建、`@jackwener/opencli` vendored | `ensure-tripyoyo-cli.mjs`、`install-opencli.mjs` | P0 |
| F16.3 | **客户端 agent 运行时在桌面端跑通**（`streamingExecutor` + `createAgentExecutors` 进程内 while 循环） | `src/store/chat/slices/aiChat/actions/streamingExecutor.ts:477` | P0 |
| F16.4 | 本地文件读写（`local-system` 12 个 API 经 IPC 落到主进程） | `LocalFileCtr`、`fileSrv`、`fileSearchSrv`、`contentSearchSrv` | P1 |
| F16.5 | Shell 命令执行 / 输出获取 / 终止 | `ShellCommandCtr` | P1 |
| F16.6 | **`exec_client_task` / `exec_client_tasks` 桌面本地子任务** | `createAgentExecutors.ts:2106,2463` + `aiAgent.createClientTaskThread` | P1 |
| F16.7 | Git 能力（分支、diff、worktree、PR 关联等 16 个 tRPC procedure 的桌面侧实现） | `GitCtr` + tRPC `device.*` | P1 |
| F16.8 | MCP 安装与调用 | `McpCtr`、`McpInstallCtr` | P1 |
| F16.9 | 网页抓取（桌面侧实现，绕过 SSRF 限制） | `WebCrawlerCtr` | P1 |
| F16.10 | 远程服务器配置与同步（桌面连远端后端） | `RemoteServerConfigCtr`、`RemoteServerSyncCtr` | P1 |
| F16.11 | IPC 事件通道：9 组共 30+ 事件（navigation / windows / update / remoteServer / gateway / protocol / system / toolDetector） | `packages/electron-client-ipc/src/events/` | P2 |
| F16.12 | 系统集成：托盘、菜单、快捷键、通知、代理、电源 | `TrayMenuCtr`、`MenuCtr`、`ShortcutCtr`、`NotificationCtr`、`NetworkProxyCtr`、`PowerCtr` | P2 |

**离线注意**：`download-lark-cli.mjs` 从 GitHub releases / npmmirror 下载，属 P0 一次性；不测飞书可整段跳过。`UpdaterCtr`（自动更新）必须保持关闭。

## F17 移动端（6）

> 移动端与 Web 共用同一后端和同一 SPA 代码库，只是换 Vite 入口 + 一套路由。成本远低于桌面端。

| ID | 功能点 | 入口 | 优先级 |
| --- | --- | --- | --- |
| F17.1 | 移动端 SPA 启动 | `bun run dev:spa:mobile`（`MOBILE=true vite --port 3012`）→ `src/spa/entry.mobile.tsx` | P0 |
| F17.2 | 移动端路由树加载 | `src/spa/router/mobileRouter.config` + `src/routes/(mobile)/` | P1 |
| F17.3 | `mobile` tRPC 命名空间（15 procedure，复用 lambda 的 16 个 router + 独立 `topic`） | `/trpc/mobile/[trpc]` | P1 |
| F17.4 | 移动端完整对话闭环（与 Web 同一 agent 链路） | `(mobile)/chat` | P1 |
| F17.5 | 移动端专有页面：`(home)` / `community` / `me` / `settings` | `src/routes/(mobile)/` | P1 |
| F17.6 | 移动端构建产物 | `bun run build:spa:mobile` | P2 |

---

## 覆盖度说明

**本清单已覆盖**：服务端 agent 运行时全链路、客户端 agent 运行时、对外 REST、内置工具矩阵、上下文工程、HIL、群体编排、评测、可观测性、**桌面端 Electron、移动端**。

**本清单未覆盖（需要时另行拆解）**：
- Web 端前端 UI 细粒度交互（`src/features/`、29 个 Zustand store 的 UI 侧行为）
- CLI（`apps/cli/`）—— 桌面端只验证它能被构建和调用，不测其自身命令面
- 认证/OIDC 完整流程（`/oidc/*`、`better-auth`、各 SSO provider）—— 离线方案走开发态旁路
- 文件处理管线细节（`file-loaders` 的各格式 loader）
- 图像/视频生成（ComfyUI、`generation*` router）
- 市场（`market` router 14 procedure）与插件安装流程 —— 离线下 Market 被 mock 成空列表
- 数据导入导出（`importer` / `exporter`）

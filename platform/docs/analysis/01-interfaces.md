# 阶段 1 · 接口拆解

> 只读静态分析。基线 `main` @ `94dd700`。所有行号基于该 commit。

## 1. 接口全景

| # | 通道 | 协议 | 入口路径 | 鉴权方式 | 消费方 |
| --- | --- | --- | --- | --- | --- |
| 1 | OpenAPI REST | HTTP/JSON（Hono） | `/api/v1/*` | OIDC JWT / API Key | 第三方、外部系统 |
| 2 | Agent 运行时 | HTTP + SSE | `/api/agent/*` | QStash 签名 / `KEY_VAULTS_SECRET` / 平台签名 | 队列服务、前端、Bot 平台 |
| 3 | 模型直连 | HTTP 流 | `/webapi/*` | 会话态 | 前端 |
| 4 | 工作流回调 | HTTP | `/api/workflows/*`、`/api/internal/*` | QStash 签名 | QWorkflow 服务 |
| 5 | 三方 Webhook | HTTP | `/api/webhooks/*` | 各自签名 | Casdoor / Logto / 视频服务 |
| 6 | 认证 | HTTP | `/api/auth/*`、`/oidc/*` | — | 浏览器 |
| 7 | 市场代理 | HTTP | `/market/*` | 受信客户端密钥 | 前端 |
| 8 | 内部 RPC | tRPC（superjson） | `/trpc/{lambda,tools,async,mobile}` | `authedProcedure` | SPA 前端、桌面端 |

后端 `route.ts` 文件共 **64** 个，完整列表见 [附录 A](#附录-a后端路由文件全清单)。

---

## 2. 对外 REST：`/api/v1/*`

### 2.1 装配与中间件

入口：`src/app/(backend)/api/v1/[[...route]]/route.ts` → `packages/openapi/src/app.ts`

```
Hono().basePath('/api/v1')
  ├─ cors()                    ← 无 origin 白名单（app.ts:15）
  ├─ logger()                  ← 每请求一行日志（app.ts:16）
  ├─ prettyJSON()
  ├─ userAuthMiddleware        ← 全局挂载（app.ts:18）
  ├─ onError → 500 { error: message }
  ├─ GET /health               ← 在 auth 之后注册，但 middleware 对其无强制
  └─ 13 个资源路由（routes/index.ts）
```

分层：`route → middleware(requireAuth + requireAnyPermission + zValidator) → controller → service → model/DB`。
`BaseController`（`common/base.controller.ts`）+ `BaseService`（`common/base.service.ts`）提供统一响应包装与错误处理。

### 2.2 鉴权（`packages/openapi/src/middleware/auth.ts`）

| 顺序 | 分支 | 条件 | 结果 |
| --- | --- | --- | --- |
| 1 | **开发态旁路** | `NODE_ENV=development` **且** 请求头 `lobe-auth-dev-backend-api: 1` | `userId = process.env.MOCK_DEV_USER_ID`，`authType='debug'`，直接放行（`auth.ts:51-56`） |
| 2 | API Key | `Authorization: Bearer sk-lh-{16位字母数字}`（`validateApiKeyFormat`） | 查 `ApiKeyModel`，命中写入内存缓存 `Map`，TTL 5 分钟（`auth.ts:16-40`） |
| 3 | OIDC JWT | Bearer 但非 API Key 格式 | `validateOIDCJWT(token)` |
| 4 | 无凭证 | — | `HTTPException` 401 |

授权：`requireAnyPermission(permissions[], message)`（`middleware/permission-check.ts`），权限常量来自 `@/utils/rbac` 的 `getScopePermissions(action, ['ALL','OWNER'])` / `getAllScopePermissions(action)`。

> 同样的开发态旁路还存在于另外两处入口：`src/libs/trpc/lambda/context.ts:98`、`src/app/(backend)/middleware/auth/index.ts:41`。三处均有 `NODE_ENV === 'development'` 守卫。

### 2.3 端点清单（79 个）

#### agents（5）— `AgentController` → `AgentService` → `AgentModel`

| 方法 | 路径 | 入参 | 权限 |
| --- | --- | --- | --- |
| GET | `/agents` | query `PaginationQuerySchema` | `AGENT_READ`（ALL/OWNER 任一） |
| POST | `/agents` | json `CreateAgentRequestSchema`：`title`(必填,min 1) / `avatar` / `description` / `model` / `provider` / `systemRole` / `params` / `chatConfig{autoCreateTopicThreshold, enableAutoCreateTopic, enableCompressHistory, enableHistoryCount, enableMaxTokens, enableReasoning, enableReasoningEffort, historyCount, reasoningBudgetToken, reasoningEffort(low/medium/high), searchFCModel, searchMode, useModelBuiltinSearch, displayMode(chat/docs), disableContextCaching}` | `AGENT_CREATE` |
| GET | `/agents/:id` | param `AgentIdParamSchema` | `AGENT_READ` |
| PATCH | `/agents/:id` | param + json `UpdateAgentRequestSchema`（= Create 的 `.partial()`） | `AGENT_UPDATE` |
| DELETE | `/agents/:id` | param | `AGENT_DELETE` |

#### agent-groups（5）
`GET /` `POST /` `GET /:id` `PATCH /:id` `DELETE /:id` — 权限族 `AGENT_GROUP_*`，依赖 `AgentGroupService`。

#### topics（5）
`GET /`（`TopicListQuerySchema`，支持分页 + agent/group 过滤）`POST /`（`TopicCreateRequestSchema`）`GET /:id` `PATCH /:id` `DELETE /:id` — 权限族 `TOPIC_*`。

#### messages（7）
`GET /count` `GET /` `GET /:id` `POST /` `POST /replies` `DELETE /:id` `DELETE /`

#### message-translations（4）
`POST /:messageId` `GET /:messageId` `PATCH /:messageId` `DELETE /:messageId` — 会触发 LLM 调用。

#### files（11）
`GET /` `POST /` `GET /:id` `GET /:id/url` `PATCH /:id` `DELETE /:id` `POST /:id/parses` `POST /:id/chunks` `GET /:id/chunks` `POST /batches` `POST /queries`
依赖：S3/RustFS + `file-loaders` + chunk/embedding 管线。

#### knowledge-bases（9）
`GET /` `POST /` `GET /:id` `PATCH /:id` `DELETE /:id` `GET /:id/files` `POST /:id/files/batch` `DELETE /:id/files/batch` `POST /:id/files/move`
依赖：pgvector。

#### models（4）
`GET /` `POST /` `GET /:providerId/:modelId` `PATCH /:providerId/:modelId`

#### providers（5）
`GET /` `GET /:id` `POST /` `PATCH /:id` `DELETE /:id` — 涉及 KeyVaults 加解密（`KEY_VAULTS_SECRET`）。

#### roles（8）
`GET /` `POST /` `GET /:id` `GET /:id/permissions` `PATCH /:id/permissions` `DELETE /:id/permissions` `PATCH /:id` `DELETE /:id`

#### permissions（5）
`GET /` `GET /:id` `POST /` `PATCH /:id` `DELETE /:id`

#### users（9）
`GET /me`（仅需登录，无额外权限）`GET /` `POST /` `GET /:id` `PATCH /:id` `DELETE /:id` `GET /:id/roles` `PATCH /:id/roles` `DELETE /:id/roles`

#### health（1）
`GET /health` → `{ service: 'lobe-chat-api', status: 'ok', timestamp }`

#### responses（1）— **最重要的对外接口**

`POST /api/v1/responses`，OpenResponses（OpenAI Responses API）兼容协议。

**入参** `CreateResponseRequestSchema`（`packages/openapi/src/types/responses.type.ts:168-191`，`.passthrough()`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | `string`（必填） | **被当作 `agentId` 使用**（见下方链路） |
| `input` | `string \| InputItem[]` | 支持 `message` / `function_call` / `function_call_output` item；content part 支持 `input_text` / `input_image{image_url, detail}` / `input_file{file_id, file_data, filename}` / `output_text` |
| `instructions` | `string?` | 拼进 systemRole |
| `previous_response_id` | `string?` | 多轮：从中解出 `topicId` |
| `stream` | `boolean?` | 决定走同步还是流式分支 |
| `max_output_tokens` / `temperature` / `top_p` / `parallel_tool_calls` / `tool_choice` / `tools` / `truncation` / `reasoning` / `metadata` / `user` | — | OpenAI 协议对齐字段 |

**出参** `ResponseObject`（`responses.type.ts:197-227`）：`{id, object:'response', created_at, completed_at, status, model, output: OutputItem[], output_text, usage{input_tokens, output_tokens, total_tokens}, error, ...}`。

**依赖链**：`ResponsesController` → `ResponsesService.createResponse()` → `AiAgentService.execAgent({agentId: model, prompt, instructions, autoStart: false, stream: false})` → `AgentRuntimeService.executeSync(operationId)`。

> ⚠️ 非流式分支用 `executeSync`（`AgentRuntimeService.ts:2293-2392`）：**在当前 HTTP 请求内同步 while 循环跑完整个 agent，`queueService: null`，默认 `maxSteps=999`**。这意味着一次 `POST /responses` 会占住一个 Node 请求直到 agent 全部跑完 —— 是阶段 6 压测的头号观察对象（超时风险 + 无背压）。
> 流式分支 `createStreamingResponse` 则订阅 Agent Runtime 的 stream 事件并转换为 OpenResponses SSE 事件。

---

## 3. Agent 运行时接口：`/api/agent/*`

### 3.1 `POST /api/agent/run` —— 单步执行器

文件：`src/app/(backend)/api/agent/run/route.ts`

| 项 | 内容 |
| --- | --- |
| 入参 | `{operationId: string(必填), stepIndex?: number = 0, context?: AgentRuntimeContext, humanInput?: any, approvedToolCall?: any, rejectionReason?: string}` |
| 鉴权 | `verifyQStashSignature(request, rawBody)`，读 `X-ZxQstash-Signature` 或 `Upstash-Signature` |
| 出参 | `{success, status, completed, stepIndex, nextStepIndex?, nextStepScheduled, totalSteps, totalCost, executionTime, operationId, pendingApproval?, pendingPrompt?, pendingSelect?, waitingForHuman, error?}` |
| 错误码 | `401` 签名失败 / operation 元数据缺 `userId`；`400` 缺 `operationId`；**`429` + `Retry-After: 37`** 该 step 被其它实例持锁；`500` 执行异常（回传 `error.message`） |
| 依赖 | `verifyQStashSignature` → `AgentRuntimeCoordinator.getOperationMetadata` → `getServerDB()` → `AgentRuntimeService.executeStep` → `triplog` |

```
GET /api/agent/run  →  { healthy: true, message, timestamp }   // 健康检查，无鉴权
```

> ⚠️ `verifyQStashSignature` 在**未配置** `ZXQSTASH_CURRENT_SIGNING_KEY` / `ZXQSTASH_NEXT_SIGNING_KEY` 时直接 `return false`（`src/libs/qstash/index.ts:69-72`）——fail-closed。本地未配密钥时该端点恒 401，本地驱动必须走进程内回调（见 §5.2）。

### 3.2 `GET /api/agent/stream` —— SSE 事件流

文件：`src/app/(backend)/api/agent/stream/route.ts`

| 项 | 内容 |
| --- | --- |
| 入参 | query：`operationId`(必填)、`lastEventId`(默认 `'0'`)、`includeHistory`(`'true'` 才生效) |
| 出参 | `text/event-stream` |
| **鉴权** | ~~**无**~~ → **需认证**（2026-08-09 加，PLAN §23.1）：cookie 会话 / `Oidc-Auth` 头 / 开发态旁路，三条路径与 tRPC lambda 严格一致。⚠️ **仍不校验归属用户** —— 带凭证可订阅任意 `operationId`，属内网信任模型下的有意识取舍 |
| 行为 | ① 立即发 `connection` 事件；② `includeHistory` 时补发最近 50 条历史（按时间正序，过滤 `> lastEventId`）；③ 订阅 `StreamEventManager.subscribeStreamEvents`；④ 每 30s 发 `heartbeat`；⑤ 收到 `agent_runtime_end` 立刻置 `streamEnded=true` + `cleanup()` + `controller.close()` |
| 客户端 | `src/services/agentRuntime/client.ts`（`fetchEventSource`，桌面端经 `lobe-backend://` 协议代理） |

事件类型（由 `StreamEventManager` 发布）：`agent_runtime_init`、`llm_start`、`llm_stream`、`llm_result`、`tool_pending`、`tool_result`、`context_engine_result`、`human_*_required`、`compression_*`、`agent_runtime_end`、`heartbeat`、`connection`、`error`。

### 3.3 其它

| 端点 | 方法 | 入参 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `/api/agent/gateway/start` | POST | `{restart?: boolean}` | `Authorization: Bearer <KEY_VAULTS_SECRET>` | 启动/重启 WebSocket Agent Gateway（`GatewayService.ensureRunning()`） |
| `/api/agent/webhooks/[platform]/[[...appId]]` | POST | 平台原始 body | 平台自有签名 | 统一 Bot webhook 入口；`getBotMessageRouter().getWebhookHandler(platform, appId)` 分发。可选 catch-all 是为了在 Vercel 上只生成一个 serverless function |
| `/api/agent/webhooks/bot-callback` | POST | — | — | Bot 异步回复回调 |
| `/api/agent` | — | — | — | 目录级 route |

---

## 4. 其它 HTTP 通道

### 4.1 `/webapi/*`（13 个）
`chat/[provider]`、`models/[provider]`、`models/[provider]/pull`、`create-image/comfyui`、`plugin/gateway`、`proxy`、`revalidate`、`stt/openai`、`tts/edge`、`tts/microsoft`、`tts/openai`、`trace`、`user/avatar/[id]/[image]`

### 4.2 `/api/workflows/*`（13 个）—— QWorkflow 驱动
```
agent-eval-run/{run-benchmark, paginate-test-cases, execute-test-case,
                run-agent-trajectory, resume-agent-trajectory, on-trajectory-complete,
                run-thread-trajectory, resume-thread-trajectory, on-thread-complete,
                finalize-run}
agent-operation/[[...route]]      ← 含 watchdog（src/server/workflows-hono/agentOperation/handlers/watchdog.ts）
task/[[...route]]
memory-user-memory/[[...route]]
```

### 4.3 `/api/internal/*`（5）
`eval/[[...route]]`、`memory/[[...route]]`、`platform-cron/[[...route]]`、`qworkflow-smoke`、`qworkflow-parallel-smoke`

### 4.4 `/api/webhooks/*`（7）
`casdoor`、`logto`、`memory-extraction`、`memory-extraction/benchmark-locomo`、`memory-user-memory/persona/update-writing`、`memory-user-memory/pipelines/extract/chat-topic/cancel`、`video/[provider]`

### 4.5 其它
`/api/auth/{[...all], check-user, resolve-username}`、`/api/version`、`/api/dev/memory-user-memory/benchmark-locomo`、`/oidc/{[...oidc], callback/desktop, consent, handoff}`、`/market/{agent, oidc, social, user/me, user/[username]}`、`/f/[id]`

---

## 5. 对内 tRPC 接口

### 5.1 命名空间

| 命名空间 | 路径 | procedure 数 | 用途 |
| --- | --- | --- | --- |
| `lambda` | `/trpc/lambda/[trpc]` | **517**（50 子 router）+ healthcheck | 主业务面 |
| `tools` | `/trpc/tools/[trpc]` | 25 | 工具执行（MCP/Klavis/Market/Search） |
| `async` | `/trpc/async/[trpc]` | 9 | 异步任务（文件解析、embedding、eval、memory） |
| `mobile` | `/trpc/mobile/[trpc]` | 15 | 移动端裁剪面（复用 lambda 的 16 个 router + 独立 topic） |

传输：`superjson`；错误格式化保留 `error.cause.data` → `shape.data.errorData`（`src/libs/trpc/lambda/init.ts:18-25`）。

### 5.2 `lambda` 子 router 全量（按 procedure 数排序）

| Router | 数 | Procedure |
| --- | --- | --- |
| `task` | 38 | `create, update, delete, detail, find, list, groupList, run, clearAll, updateStatus, updateConfig, getSubtasks, getTaskTree, reorderSubtasks, previewSubtaskLayers, runReadySubtasks, addDependency, removeDependency, getDependencies, addComment, updateComment, deleteComment, getTopics, cancelTopic, deleteTopic, pinDocument, unpinDocument, getPinnedDocuments, heartbeat, watchdog, acquireTaskLock, getTaskLock, releaseTaskLock, getCheckpoint, updateCheckpoint, getReview, updateReview, runReview` |
| `agentEval` | 31 | benchmark ×5、dataset ×7（含 `parseDatasetFile`/`importDataset`）、testCase ×6、run ×13（`startRun, abortRun, retryRunErrors, retryRunCase, getRunProgress, getRunResults, ...`） |
| `device` | 31 | `register, status, listDevices, updateDevice, removeDevice, checkCapability, getDeviceSystemInfo, getAgentProfile, statPath, getLocalFilePreview, getProjectFileIndex, writeProjectFile, moveProjectFiles, renameProjectFile, listProjectSkills` + Git 系 16 个（`gitBranch, listGitBranches, listGitRemoteBranches, checkoutGitBranch, deleteGitBranch, renameGitBranch, pullGitBranch, pushGitBranch, gitAheadBehind, gitWorkingTreeStatus, getGitWorkingTreeFiles, getGitWorkingTreePatches, getGitBranchDiff, listGitWorktrees, gitLinkedPullRequest, revertGitFile`） |
| `message` | 29 | `createMessage, getMessages, listAll, update, updateMetadata, updateTranslate, updateTTS, updateMessageRAG, updateMessagePlugin, updatePluginState, updatePluginError, updateToolArguments, updateToolMessage, updateMessageGroupMetadata, searchMessages, count, countWords, rankModels, getHeatmaps, addFilesToMessage, createCompressionGroup, finalizeCompression, cancelCompression, removeMessage, removeMessages, removeMessageQuery, removeMessagesByAssistant, removeMessagesByGroup, removeAllMessages` |
| `topic` | 25 | `createTopic, batchCreateTopics, getTopics, getAllTopics, getTopicContext, hasTopics, countTopics, rankTopics, recentTopics, searchTopics, updateTopic, updateTopicMetadata, cloneTopic, importTopic, batchMoveTopics, batchDelete, batchDeleteByAgentId, batchDeleteBySessionId, removeTopic, removeAllTopics, enableSharing, disableSharing, updateShareVisibility, getShareInfo, getCronTopicsGroupedByCronJob` |
| `agent` | 20 | `createAgent, createAgentOnly, queryAgents, getAgentConfig, getAgentConfigById, getBuiltinAgent, updateAgentConfig, updateAgentPinned, duplicateAgent, removeAgent, checkByMarketIdentifier, getAgentByMarketIdentifier, getAgentByForkedFromIdentifier, createAgentFiles, deleteAgentFile, toggleFile, createAgentKnowledgeBase, deleteAgentKnowledgeBase, toggleKnowledgeBase, getKnowledgeBasesAndFiles` |
| `agentSkills` | 20 | `create, update, delete, list, search, getById, getByIdWithZipUrl, getByIdentifier, getByName, listResources, readResource, importFromGitHub, importFromUrl, importFromZip, importFromMarket, startScanForZip, startScanForGitHub, startScanForUrl, getScanStatus, syncToWeb` |
| `agentDocument` | 19 | `createDocument, getDocument, getDocuments, getDocumentsMap, listForTopic, readDocument, editDocument, upsertDocument, removeDocument, deleteDocument, deleteAllDocuments, copyDocument, renameDocument, cloneDocuments, hasDocuments, getContext, getTemplates, initializeFromTemplate, updateLoadRule` |
| `userMemories` | 19 | `queryMemories, queryActivities, queryExperiences, queryIdentities, queryIdentitiesForInjection, queryIdentityRoles, queryTags, getMemoryDetail, searchMemory, retrieveMemoryForTopic, reEmbedMemories` + 8 个 `tool*` 桥接（对应 memory 工具的 8 个 API） |
| `userMemory` | 19 | identity/preference/experience/context/activity 各自 CRUD + `getPersona, requestMemoryFromChatTopic, getMemoryExtractionTask` |
| `user` | 16 | `getUserState, getUserSSOProviders, getUserRegistrationDuration, makeUserOnboarded, updateOnboarding, updateGuide, updateInterests, updatePreference, updateSettings, resetSettings, updateAvatar, updateFullName, updateUsername, updateFeishuBinding, syncFeishuBindingFromToken, updateMcpAdaToken` |
| `agentGroup` | 15 | `createGroup, createGroupWithMembers, getGroup, getGroups, getGroupDetail, getGroupAgents, getGroupByForkedFromIdentifier, updateGroup, duplicateGroup, deleteGroup, addAgentsToGroup, batchCreateAgentsInGroup, updateAgentInGroup, removeAgentsFromGroup, checkAgentsBeforeRemoval` |
| **`aiAgent`** | **14** | 见 §5.3 |
| `market` | 14 | `getAssistantList/Detail, getSkillList/Detail, getMcpList/Detail, getKnowledgeBaseList/Detail, getLeaderboard, getUnpublishedResources, getPublisherResourceStates, recordAgentUsage, recordSkillUsage, recordMcpUsage` |
| `ragEval` | 14 | dataset ×4、datasetRecords ×5、evaluation ×5 |
| `file` | 13 | `createFile, findById, getFileItemById, getFiles, getKnowledgeItems, recentFiles, recentPages, checkFileHash, updateFile, removeFile, removeFiles, removeAllFiles, removeFileAsyncTask` |
| `session` | 13 | `createSession, batchCreateSessions, getSessions, getGroupedSessions, countSessions, rankSessions, searchSessions, cloneSession, updateSession, updateSessionConfig, updateSessionChatConfig, removeSession, removeAllSessions` |
| `agentBotProvider` | 11 | `listPlatforms, list, create, update, delete, getByAgentId, connectBot, testConnection, getRuntimeStatus, refreshRuntimeStatus, refreshRuntimeStatusesByAgent` |
| `aiModel` | 11 | `createAiModel, getAiModelById, getAiProviderModelList, updateAiModel, updateAiModelOrder, batchUpdateAiModels, batchToggleAiModels, toggleModelEnabled, clearModelsByProvider, clearRemoteModels, removeAiModel` |
| `aiProvider` | 11 | `createAiProvider, getAiProviderById, getAiProviderList, getAiProviderRuntimeState, updateAiProvider, updateAiProviderConfig, updateAiProviderOrder, toggleProviderEnabled, checkProviderConnectivity, checkAdaCodingPlan, removeAiProvider` |
| `agentCronJob` | 10 | `create, update, delete, list, findById, findByAgent, batchUpdateStatus, resetExecutions, getStats, getNearDepletion` |
| `agentEvalExternal` | 10 | `datasetGet, testCasesCount, messagesList, threadsList, runGet, runSetStatus, runTopicsList, runTopicReportResult, reportResult, reportResultsBatch` |
| `document` | 10 | `createDocument, createDocuments, getDocumentById, queryDocuments, getFolderBreadcrumb, parseDocument, parseFileContent, updateDocument, deleteDocument, deleteDocuments` |
| `knowledgeBase` | 9 | `createKnowledgeBase, getKnowledgeBaseById, getKnowledgeBases, updateKnowledgeBase, addFilesToKnowledgeBase, removeFilesFromKnowledgeBase, importFromFeishu, removeKnowledgeBase, removeAllKnowledgeBases` |
| `apiKey` | 8 | `createApiKey, getApiKey, getApiKeyById, getApiKeys, updateApiKey, validateApiKey, deleteApiKey, deleteAllApiKeys` |
| `brief` | 8 | `create, find, findByTaskId, list, listUnresolved, markRead, resolve, delete` |
| `chunk` | 7 | `createParseFileTask, retryParseFileTask, createEmbeddingChunksTask, getChunksByFileId, getFileContents, semanticSearch, semanticSearchForChat` |
| `klavis` | 7 | `createServerInstance, getServerInstance, deleteServerInstance, getKlavisPlugins, updateKlavisPlugin, removeKlavisPlugin, getUserIntergrations` |
| `thread` | 7 | `createThread, createThreadWithMessage, getThread, getThreads, updateThread, removeThread, removeAllThreads` |
| `plugin` | 6 | `createPlugin, createOrInstallPlugin, getPlugins, updatePlugin, removePlugin, removeAllPlugins` |
| `sessionGroup` | 6 | `createSessionGroup, getSessionGroup, updateSessionGroup, updateSessionGroupOrder, removeSessionGroup, removeAllSessionGroups` |
| `generationTopic` | 5 | `createTopic, getAllGenerationTopics, updateTopic, updateTopicCover, deleteTopic` |
| `notebook` | 5 | `createDocument, getDocument, listDocuments, updateDocument, deleteDocument` |
| `oauthDeviceFlow` | 4 | `initiateDeviceCode, pollAuthStatus, getAuthStatus, revokeAuth` |
| `comfyui` / `home` / `importer` / `taskTemplate` / `usage` | 3 各 | — |
| `aiChat` / `exporter` / `generation` / `generationBatch` / `video` / `config` | 2 各 | — |
| `knowledge` / `search` / `share` / `upload` / `image` | 1 各 | — |

> `src/business/server/lambda-routers/` 下 5 个 router（`accountDeletion`、`referral`、`spend`、`subscription`、`topUp`）在本 fork 中是 **空壳** `router({})`；`taskTemplate` 和 `config` 只是对 `src/server/routers/lambda/` 的 re-export。

### 5.3 `aiAgent` router —— Agent 编排核心（14 procedure）

文件：`src/server/routers/lambda/aiAgent.ts`（1275 行）
上下文注入：`aiAgentProcedure` 在 ctx 中注入 `agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId)`（`aiAgent.ts:276`）。

| Procedure | 类型 | 入参（zod） | 出参 | 下游 |
| --- | --- | --- | --- | --- |
| `createOperation` | mutation | `agentConfig=record({})`、`agentId?`、`autoStart=true`、`messages=[]`、`modelRuntimeConfig{model,provider}`(必填)、`threadId?`、`topicId?`、`tools?`、`toolManifestMap=record({})`、`userId?` | `{operationId, status:'created', autoStart, firstStep?{context, messageId, scheduled}, createdAt, success}` | `AgentRuntimeService.createOperation` |
| `startExecution` | mutation | `operationId`、`context?`、`delay=1000`、`priority='normal'`(high/normal/low) | `{success, operationId, scheduled, messageId?}` | `.startExecution` |
| `getOperationStatus` | query | `operationId`、`includeHistory=false`、`historyLimit=10` | `OperationStatusResult`：`{operationId, isActive, isCompleted, hasError, needsHumanInput, currentState{status, stepCount, cost, costLimit, usage, maxSteps, error, interruption, pending*, lastModified}, metadata, stats{totalSteps, totalCost, totalMessages, uptime, lastActiveTime}, executionHistory?, recentEvents?}` | `.getOperationStatus` |
| `getPendingInterventions` | query | `operationId?` **或** `userId?`（refine 二选一） | `{pendingInterventions[{operationId, type:'tool_approval'\|'human_prompt'\|'human_select', status, stepCount, pendingToolsCalling?, pendingHumanPrompt?, pendingHumanSelect?, modelRuntimeConfig?, userId?, lastModified}], totalCount, timestamp}` | `.getPendingInterventions` |
| `processHumanIntervention` | mutation | `operationId`、`action: 'approve'\|'reject'\|'input'\|'select'`、`data{approvedToolCall?, input?, selection?}`、`stepIndex=0`、`reason?` | 调度结果 | `.processHumanIntervention` |
| `interruptTask` | mutation | `operationId` | `boolean` | `.interruptOperation` |
| `execAgent` | mutation | `agentId`/`slug`、`prompt`、`files?`、`groupId?`、`message?`、`newTopic?`、`topicId?` | 任务句柄 | `AiAgentService.execAgent` |
| `execAgents` | mutation | `parallel?`、`tasks[]` | 批量句柄 | 同上 |
| `execGroupAgent` | mutation | `agentId`、`groupId`、`instruction`、`parentMessageId`、`title`、`topicId`、`timeout?` | — | 群体派发 |
| `execSubAgentTask` | mutation | `groupId`、`instruction`、`parentMessageId`、`subAgentId`、`title`、`topicId` | — | 隔离子 agent |
| `getSubAgentTaskStatus` | query | — | 子任务状态 | — |
| `createClientTaskThread` | mutation | — | `{success, threadId, userMessageId, messages, threadMessages, startedAt}` | 桌面端本地任务线程 |
| `createClientGroupAgentTaskThread` | mutation | — | 同上 | — |
| `updateClientTaskThreadStatus` | mutation | `threadId`、`completionReason`、`resultContent`、`error?`、`metadata?` | — | 客户端结果回写 |

### 5.4 `aiChat` router（2 procedure）

| Procedure | 入参 | 出参 |
| --- | --- | --- |
| `outputJSON` | `StructureOutputSchema{provider, model, messages, schema, tools?}` | `modelRuntime.generateObject()` 的结果 |
| `sendMessageInServer` | `AiSendMessageServerSchema{agentId, sessionId?, groupId?, topicId?, threadId?, newTopic?{title, topicMessageIds}, newThread?{sourceMessageId, type, title, parentThreadId}, preloadMessages?[], newUserMessage{content, parentId?, files?, editorData?, metadata?, pageSelections?}, newAssistantMessage{model, provider, metadata?}}` | `SendMessageServerResponse{userMessageId, assistantMessageId, topicId, createdThreadId?, isCreateNewTopic, messages, topics}` |

`sendMessageInServer` 的落库顺序（`aiChat.ts:69-222`）：解析 sessionId → 建 topic（如需，并 `touchUpdatedAt` agent）→ 建 thread（如需）→ 逐条建 preload message（串成 parentId 链）→ 建 user message → 建 assistant message（`content = LOADING_FLAT` 占位）→ `getMessagesAndTopics` 回读。

### 5.5 `tools` / `async` / `mobile`

| Router | Procedure |
| --- | --- |
| `tools.market`（13） | `callCloudMcpEndpoint, callCodeInterpreterTool, execInSandbox, connectCallTool, connectGetAllHealth, connectGetAuthorizeUrl, connectGetStatus, connectListConnections, connectListProviders, connectListTools, connectRefresh, connectRevoke, exportAndUploadFile` |
| `tools.mcp`（5） | `getStreamableMcpServerManifest, listTools, listResources, listPrompts, callTool` |
| `tools.search`（3） | `query, webSearch, crawlPages` |
| `tools.klavis`（3） | `listTools, getTools, callTool` |
| `async.eval`（2） | `runBenchmark, executeTestCase` |
| `async.file`（2） | `parseFileToChunks, embeddingChunks` |
| `async.memory`（2） | `runExtraction, continueTopicBatches` |
| `async.image`（1） | `createImage` |
| `async.ragEval`（1） | `runRecordEvaluation` |
| `mobile.topic`（14） | topic 子集 |

---

## 6. 核心链路

### 6.1 主链路：一次完整对话

```mermaid
sequenceDiagram
  autonumber
  participant U as SPA 前端
  participant TR as tRPC lambda
  participant SVC as AgentRuntimeService
  participant Q as QueueService
  participant RUN as POST /api/agent/run
  participant ENG as AgentRuntime (Engine)
  participant BRN as GeneralChatAgent (Brain)
  participant EX as RuntimeExecutors
  participant CE as ContextEngine
  participant LLM as ModelRuntime
  participant R as Redis
  participant PG as PostgreSQL
  participant SSE as GET /api/agent/stream

  U->>TR: aiChat.sendMessageInServer
  TR->>PG: 建 topic/thread/preload/user/assistant 消息
  TR-->>U: {userMessageId, assistantMessageId, messages}

  U->>TR: aiAgent.createOperation
  TR->>SVC: createOperation(params)
  SVC->>SVC: operationId = agt_{ts}_{agentId}_{topicId}_{nanoid8}
  SVC->>SVC: 组装 OperationToolSet（AgentToolsEngine）
  SVC->>R: createOperationMetadata + saveAgentState
  SVC->>PG: 写 agent_operations 追踪行
  SVC->>Q: scheduleMessage(stepIndex=0, delay)
  TR-->>U: {operationId, firstStep.scheduled}

  U->>SSE: GET /stream?operationId=...
  SSE->>R: subscribeStreamEvents

  Q->>RUN: QStash 投递（或本地 setTimeout 直调）
  RUN->>RUN: verifyQStashSignature
  RUN->>R: getOperationMetadata → userId
  RUN->>SVC: executeStep({operationId, stepIndex})

  loop 每一步
    SVC->>R: tryClaimStep (SET NX EX 35) — 抢不到 → 429
    SVC->>R: loadAgentState
    SVC->>SVC: onBeforeStep + Hook('beforeStep')
    SVC->>ENG: step(state, context)
    ENG->>ENG: structuredClone(state); stepCount++
    ENG->>BRN: runner(context, state)
    BRN-->>ENG: AgentInstruction[]
    alt call_llm
      ENG->>EX: call_llm executor
      EX->>CE: serverMessagesEngine（~40 阶段）
      EX->>R: publish context_engine_result
      EX->>LLM: 流式调用
      LLM-->>EX: chunks
      EX->>R: publish llm_stream（双缓冲 flush）
      EX->>PG: 落 assistant message
    else call_tools_batch
      ENG->>EX: 按 toolSourceMap 路由 builtin/plugin/mcp/klavis/skill
      EX->>R: publish tool_result
    else request_human_*
      ENG->>ENG: status = waiting_for_human
    else finish
      ENG->>ENG: status = done
    end
    ENG-->>SVC: {events, newState, nextContext}
    SVC->>R: saveStepResult（SETEX state + LPUSH steps/events）
    SVC->>SVC: onAfterStep + Hook('afterStep') + stepWebhook
    SVC->>SVC: [dev] agent-tracing 写 .agent-tracing/_partial/
    alt shouldContinueExecution
      SVC->>Q: scheduleMessage(stepIndex+1)
    else 终态
      SVC->>R: publishAgentRuntimeEnd
      SVC->>SVC: onComplete + completionWebhook
    end
  end

  R-->>SSE: agent_runtime_end
  SSE-->>U: 关闭连接
```

**关键代码锚点**

| 阶段 | 位置 |
| --- | --- |
| operation 创建 | `src/server/services/agentRuntime/AgentRuntimeService.ts:288-470` |
| 单步执行 | `AgentRuntimeService.ts:480-1270` |
| 步锁 | `src/server/modules/AgentRuntime/AgentStateManager.ts:407-422`（`SET NX EX 35`） |
| 状态持久化 | `AgentStateManager.ts:51-56`（`SETEX`，TTL 2h = `DEFAULT_TTL`），`:100-142`（pipeline） |
| Engine 循环 | `packages/agent-runtime/src/core/runtime.ts:80-225` |
| Brain 决策 | `packages/agent-runtime/src/agents/GeneralChatAgent.ts` |
| 服务端 executor | `src/server/modules/AgentRuntime/RuntimeExecutors.ts:114`（`createRuntimeExecutors`），`call_llm:121`、`compress_context:711`、`call_tool:959`、`call_tools_batch:1247`、`finish:1557`、`request_human_approve:1594`、`resolve_aborted_tools:1653` |
| Agent + Runtime 装配（服务端） | `AgentRuntimeService.ts:1605`（`new GeneralChatAgent`）、`:1634`（`new AgentRuntime`） |
| 终态事件去重 | `src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts:12-18` |

### 6.2 分支链路

#### HIL（人在环）
```
Brain 判定需审批 → request_human_approve
  → state.pendingToolsCalling / status='waiting_for_human'
  → 发 human_approve_required 事件 → 前端弹审批
  → aiAgent.processHumanIntervention({action:'approve', data.approvedToolCall})
  → AgentRuntimeService.processHumanIntervention → 写回 state
  → QueueService.scheduleMessage → executeStep(phase='human_approved_tool')
  → runtime.step 直接合成 call_tool 指令（runtime.ts:109-124，跳过 agent.runner）
```

#### 子 Agent 桥接
```
callSubAgent 工具 → 派生 child operation（appContext.parentOperationId, isSubAgent=true）
  → 父：占位 role:'tool' 消息 + status='waiting_for_async_tool'
  → child 到终态 → AgentRuntimeService.completeSubAgentBridge({parentOperationId, toolMessageId, threadId, finalState})
  → 回填父的占位消息 → 父恢复 running → scheduleMessage
  → 若 barrier 未清：verifyAsyncToolBarrier + asyncToolVerifyAttempt 有界退避重试
```

#### OpenResponses 同步链路
```
POST /api/v1/responses (stream=false)
  → ResponsesService.createResponse
  → AiAgentService.execAgent({agentId: model, autoStart:false, stream:false})
  → new AgentRuntimeService(db, userId, {queueService: null})
  → executeSync(operationId)     ← 同步 while 循环，最多 999 步，全程占住 HTTP 请求
  → extractOutputItems + extractUsage → ResponseObject
```

#### 客户端（浏览器/桌面）本地循环
```
src/store/chat/slices/aiChat/actions/streamingExecutor.ts:477
  → new GeneralChatAgent({agentConfig:{maxSteps:1000}, compressionConfig:{...}, ...})
  → new AgentRuntime(agent, {executors: createAgentExecutors({...}), getOperation, operationId})
  → while (state.status !== 'done' && !== 'error') { runtime.step(...) }
```
与服务端共用同一 Brain + Engine，只换 executor 实现（详见 [02-architecture.md](02-architecture.md) §3）。

---

## 7. 接口层面的观察（**已按阶段 5/6 实测更新状态，2026-08-09**）

> 原为「待验证的观察」。下表加了状态列 —— **✅ 已处置 / ⚠️ 仍存在**。
> 观察原文保留，处置详情见 [PLAN.md](../../../plan/plan.md) 对应章节。

| # | 观察 | 状态 | 位置 |
| --- | --- | --- | --- |
| 1 | `/api/agent/stream` 无鉴权，仅凭 `operationId` 即可读取任意用户的完整对话流 | ✅ **已加认证 L1**（PLAN §23.1）。⚠️ **仍不校验 operation 归属** —— 内网信任模型下的有意识取舍，带凭证可订阅任意 id | `stream/route.ts` |
| 2 | `POST /api/v1/responses` 非流式走 `executeSync`，单请求内跑完整个 agent（最多 999 步），无超时保护与背压 | ⚠️ **仍存在**。风险因附录 B 修复而降低（现有默认步数上限 + 硬闸兜底），但结构问题未变 | `responses.service.ts:229-233`、`AgentRuntimeService.ts:2293` |
| 3 | API Key 校验结果内存缓存 5 分钟，吊销不即时生效 | ✅ **已处置**（PLAN §23.3）：TTL 降到 **60 秒**作地板 + Redis pub/sub 跨实例失效。Redis 不在鉴权热路径上，挂掉只退化回 TTL | `openapi/middleware/auth.ts`、`src/server/services/apiKeyCacheBus.ts` |
| 4 | `/api/agent/gateway/start` 复用 `KEY_VAULTS_SECRET`（加密密钥）作为 Bearer 凭证 | `gateway/start/route.ts:8-12` |
| 5 | `/api/v1` 全局 `cors()` 无 origin 限制 | `openapi/src/app.ts:15` |
| 6 | 开发态鉴权旁路存在于 3 处入口（均有 `NODE_ENV` 守卫） | `openapi/middleware/auth.ts:51`、`trpc/lambda/context.ts:98`、`middleware/auth/index.ts:41` |
| 7 | `/api/agent/run` 的 catch 分支直接回传 `error.message` | `run/route.ts:136` |
| 8 | QStash 签名 fail-closed：未配密钥即恒 401，且错误体只有 `Unauthorized`，排障困难 | `libs/qstash/index.ts:69-72` |

---

## 附录 A：后端路由文件全清单（64 个）

```
/api/agent                                  /api/workflows/agent-eval-run/execute-test-case
/api/agent/gateway/start                    /api/workflows/agent-eval-run/finalize-run
/api/agent/run                              /api/workflows/agent-eval-run/on-thread-complete
/api/agent/stream                           /api/workflows/agent-eval-run/on-trajectory-complete
/api/agent/webhooks/[platform]/[[...appId]] /api/workflows/agent-eval-run/paginate-test-cases
/api/agent/webhooks/bot-callback            /api/workflows/agent-eval-run/resume-agent-trajectory
/api/auth/[...all]                          /api/workflows/agent-eval-run/resume-thread-trajectory
/api/auth/check-user                        /api/workflows/agent-eval-run/run-agent-trajectory
/api/auth/resolve-username                  /api/workflows/agent-eval-run/run-benchmark
/api/dev/memory-user-memory/benchmark-locomo /api/workflows/agent-eval-run/run-thread-trajectory
/api/internal/eval/[[...route]]             /api/workflows/agent-operation/[[...route]]
/api/internal/memory/[[...route]]           /api/workflows/memory-user-memory/[[...route]]
/api/internal/platform-cron/[[...route]]    /api/workflows/task/[[...route]]
/api/internal/qworkflow-parallel-smoke      /f/[id]
/api/internal/qworkflow-smoke               /market/agent/[[...segments]]
/api/v1/[[...route]]                        /market/oidc/[[...segments]]
/api/version                                /market/social/[[...segments]]
/api/webhooks/casdoor                       /market/user/[username]
/api/webhooks/logto                         /market/user/me
/api/webhooks/memory-extraction             /oidc/[...oidc]
/api/webhooks/memory-extraction/benchmark-locomo  /oidc/callback/desktop
/api/webhooks/memory-user-memory/persona/update-writing  /oidc/consent
/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel  /oidc/handoff
/api/webhooks/video/[provider]              /trpc/async/[trpc]
/trpc/lambda/[trpc]                         /trpc/mobile/[trpc]
/trpc/tools/[trpc]                          /webapi/chat/[provider]
/webapi/create-image/comfyui                /webapi/models/[provider]
/webapi/models/[provider]/pull              /webapi/plugin/gateway
/webapi/proxy                               /webapi/revalidate
/webapi/stt/openai                          /webapi/trace
/webapi/tts/edge                            /webapi/tts/microsoft
/webapi/tts/openai                          /webapi/user/avatar/[id]/[image]
```

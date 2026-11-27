# 当前平台评测主链：教学蓝图事实底稿

核查时间：2026-11-08T15:07:03.652238+00:00。源码根目录：`[LOCAL_PATH_REDACTED]`。

本轮只读核对当前实现，没有运行服务或新增回归；仅写本目录两个事实文件，不修改platform/study_pack。GitNexus查询缺FTS，旧图为下界，因此下列行号全部取当前源码。

## 当前默认与对象层级

当前Python归因默认engineVersion为`rules-adapter-v1-increment3-reviewed`；回滚收据四文件当前hash一致：True。第三阶段候选未推广。

- Agent configuration → many evaluation Runs
- Benchmark → Dataset → TestCase
- Dataset → Runs
- Run + TestCase → RunTopic → Topic
- K=1 scores Topic messages; K>1 creates eval Threads inside same Topic and scores each Thread

## 主调用链

agent.updateAgentConfig → agentEval.createRun → snapshot + Topic/RunTopic precreate → agentEval.startRun → async eval.runBenchmark → Orchestrator pagination → runAgentTrajectory → K1 executeTrajectory / K>1 executeMultiThreadTrajectory → executeThreadTrajectory → AiAgentService.execAgent → AgentRuntimeService.createOperation → executeStep → AgentRuntime.step → GeneralChatAgent + RuntimeExecutors → onComplete hook/webhook → recordTrajectoryCompletion / recordThreadCompletion → evaluateCase/evaluateThread → eval-rubric.evaluate → rule matcher or Judge → RunTopic/Thread result write → aggregate → finalizeIfActive → SWR detail/results polling → report; changed config + new Run for another evaluation

## 15个关键源码锚点

### A01 Agent是持久化配置，执行使用合并后的配置

定义/判定位置：
- `packages/database/src/schemas/agent.ts:31` — `agents`（definition）。
- `src/server/services/agent/index.ts:132` — `AgentService.getAgentConfigById`（definition）。
- `src/server/services/agent/index.ts:262` — `AgentService.updateAgentConfig`（definition）。

实际调用/计算位置：
- `src/server/routers/lambda/agent.ts:353` — `agentRouter.updateAgentConfig → service.updateAgentConfig`（call）。

上游：Agent配置页面/agentRouter。下游：AgentModel.updateConfig；AiAgentService.execAgent。

已核实事实：
- agents持久化model/provider/systemRole/chatConfig/plugins等；AgentService合并用户默认配置。
- updateAgentConfig先写模型，再返回合并后的Agent配置。

事实边界：
- 用户Agent记录与通用GeneralChatAgent类分属配置实例和运行实现两个层次。
- 运行时还会按builtin slug补动态systemRole/plugins；单看数据库行不等于最终出站配置。

### A02 评测数据实体与会话/线程层级

定义/判定位置：
- `packages/database/src/schemas/agentEvals.ts:52` — `agentEvalBenchmarks`（definition）。
- `packages/database/src/schemas/agentEvals.ts:88` — `agentEvalDatasets`（definition）。
- `packages/database/src/schemas/agentEvals.ts:126` — `agentEvalTestCases`（definition）。
- `packages/database/src/schemas/agentEvals.ts:165` — `agentEvalRuns`（definition）。
- `packages/database/src/schemas/agentEvals.ts:212` — `agentEvalRunTopics`（definition）。
- `packages/database/src/schemas/topic.ts:81` — `threads`（definition）。

上游：评测创建API/数据库模型。下游：createRun；message/trace查询。

已核实事实：
- Benchmark保存rubrics；Dataset引用Benchmark并保存evalMode/evalConfig；TestCase引用Dataset并保存input/expected及可覆盖评分配置。
- Run引用Dataset和targetAgentId，保存状态、config、metrics；RunTopic连接runId/testCaseId/topicId并保存case级score/passed/evalResult。
- K>1在同一Topic内创建type=eval的多个Thread，消息用threadId隔离，单线程结果位于thread.metadata。

事实边界：
- RunTopic主键是(runId,topicId)，不是(runId,testCaseId)；createRun按Case预建一条属于服务行为，不是该唯一约束。
- Thread外键指Topic，Thread不是Dataset/TestCase的新副本。

### A03 创建Run与配置快照

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:62` — `AgentEvalRunService.createRun`（definition）。
- `src/server/services/agentEvalRun/index.ts:100` — `AgentEvalRunService.resolveTargetAgentId`（definition）。
- `src/server/services/agentEvalRun/index.ts:1618` — `AgentEvalRunService.snapshotAgentConfig`（definition）。

实际调用/计算位置：
- `src/server/routers/lambda/agentEval.ts:611` — `agentEvalRouter.createRun → runService.createRun`（call）。

上游：agentEvalRouter.createRun。下游：AgentEvalRunModel.create；TopicModel.batchCreate；RunTopicModel.batchCreate。

已核实事实：
- INBOX虚拟标识先解析到当前用户真实Agent ID。
- 创建Run时存agentSnapshot，并按当前Dataset的全部TestCase预建Topic与pending RunTopic。

事实边界：
- 本调用链agentSnapshot仅创建时保存；执行入口只传targetAgentId，execAgent重新读取当前配置。保存快照不能等同按快照执行或精确历史重放。
- Run本身引用Dataset；这里没有为Dataset/Benchmark规则建立同等级的不可变执行快照。

### A04 startRun、异步路由与本地编排

定义/判定位置：
- `src/server/routers/lambda/agentEval.ts:716` — `agentEvalRouter.startRun`（definition）。
- `src/server/routers/async/eval.ts:31` — `async evalRouter.runBenchmark`（definition）。
- `src/server/services/agentEvalRun/orchestrator.ts:58` — `AgentEvalRunOrchestrator.runBenchmark`（definition）。
- `src/server/services/agentEvalRun/orchestrator.ts:146` — `AgentEvalRunOrchestrator.paginateTestCases`（definition）。
- `src/server/services/agentEvalRun/orchestrator.ts:272` — `AgentEvalRunOrchestrator.runAgentTrajectory`（definition）。

实际调用/计算位置：
- `src/server/routers/lambda/agentEval.ts:744` — `asyncCaller.eval.runBenchmark`（call）。
- `src/server/services/agentEvalRun/orchestrator.ts:298` — `K>1 → executeMultiThreadTrajectory`（call）。

上游：UI RunCreateModal/startRun。下游：executeTrajectory(K=1)；executeMultiThreadTrajectory/runThreadTrajectory(K>1)。

已核实事实：
- startRun先写pending再触发asyncCaller；异步路由调用Orchestrator。
- runBenchmark加载Case并过滤待执行项，设running/startedAt/初始metrics；分页及Promise.all触发执行。
- run.config.k默认1，K>1创建多Thread再逐Thread执行。

事实边界：
- 源码使用void异步触发，存在单独workflow/webhook路径；不能据函数名宣称生产持久队列/故障恢复已验收。
- maxConcurrency在API schema接受，但当前Orchestrator/评测服务未检出其消费；实际Promise.all调度不能讲成该参数严格限并发。

### A05 评测执行Hook把Agent完成事件接回评分

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:251` — `AgentEvalRunService.executeTrajectory`（definition）。
- `src/server/services/agentEvalRun/index.ts:415` — `AgentEvalRunService.executeThreadTrajectory`（definition）。
- `src/server/services/agentEvalRun/index.ts:1028` — `AgentEvalRunService.recordTrajectoryCompletion`（definition）。
- `src/server/services/agentEvalRun/index.ts:522` — `AgentEvalRunService.recordThreadCompletion`（definition）。

实际调用/计算位置：
- `src/server/services/agentEvalRun/index.ts:281` — `K=1调用AiAgentService.execAgent`（call）。
- `src/server/services/agentEvalRun/index.ts:435` — `K>1调用AiAgentService.execAgent`（call）。

上游：Orchestrator.runAgentTrajectory/runThreadTrajectory。下游：AiAgentService.execAgent；evaluateCase/evaluateThread；orchestrator.finalizeRun。

已核实事实：
- K=1使用Topic，K>1传Topic+Thread；两路都注册onComplete hook及webhook描述。
- 本地hook记录telemetry、评分；allDone/allRunDone时复用finalizeRun。K2 startup reject也走recordThreadCompletion聚合。
- 迟到operationId使用条件写/JSON合并；评分终态与已completedAt线程不会被迟到结果直接替换。

事实边界：
- Hook是现有系统内置完成编排；新增Python诊断属于另一条诊断任务链，不参与这里的分数计算。
- 原子保护是指定写入点的约束，不等于全平台所有API都是exactly-once。

### A06 Agent执行Facade和Operation创建

定义/判定位置：
- `src/server/services/aiAgent/index.ts:272` — `AiAgentService.execAgent`（definition）。
- `src/server/services/agentRuntime/AgentRuntimeService.ts:402` — `AgentRuntimeService.createOperation`（definition）。
- `src/server/services/agentRuntime/AgentRuntimeService.ts:1668` — `AgentRuntimeService.startExecution`（definition）。

实际调用/计算位置：
- `src/server/services/aiAgent/index.ts:320` — `execAgent重新读取Agent配置`（call）。
- `src/server/services/aiAgent/index.ts:1054` — `execAgent → createOperation`（call）。

上游：评测执行服务/普通聊天调用入口。下游：AgentRuntimeCoordinator；AgentRuntimeService.executeStep。

已核实事实：
- execAgent加载Agent配置、合并builtin运行配置、准备Topic/messages/tools，并将hooks和evalContext交给createOperation。
- Operation是运行生命周期标识；返回operationId表示已创建/可异步启动，不表示任务已完成。

事实边界：
- 平台包含可配置Agent与共享运行时，不能把平台整体误称为一只固定Agent。
- 完整技能发现/设备/知识注入有附加分支，本核查只确认主调用关系。

### A07 通用决策器与运行时解释执行

定义/判定位置：
- `src/server/services/agentRuntime/AgentRuntimeService.ts:622` — `AgentRuntimeService.executeStep`（definition）。
- `src/server/services/agentRuntime/AgentRuntimeService.ts:1807` — `AgentRuntimeService.createAgentRuntime`（definition）。
- `packages/agent-runtime/src/core/runtime.ts:80` — `AgentRuntime.step`（definition）。
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts:386` — `GeneralChatAgent.runner`（definition）。

实际调用/计算位置：
- `src/server/services/agentRuntime/AgentRuntimeService.ts:1817` — `createAgentRuntime构造GeneralChatAgent`（call）。
- `src/server/services/agentRuntime/AgentRuntimeService.ts:1847` — `createAgentRuntime注入executors`（call）。
- `src/server/services/agentRuntime/AgentRuntimeService.ts:884` — `服务调用runtime.step`（call）。
- `packages/agent-runtime/src/core/runtime.ts:127` — `AgentRuntime.step调用agent.runner`（call）。

上游：Operation步骤调度/executeStep。下游：GeneralChatAgent产生AgentInstruction；RuntimeExecutors执行call_llm/call_tool/compress_context等。

已核实事实：
- GeneralChatAgent按phase决策指令；AgentRuntime.step管理stepCount并分派指令给executor。
- 服务器AgentRuntimeService另负责状态协调、步骤锁、事件和下一步调度；不能把纯包的AgentRuntime.step和服务器服务混作同一类。
- AgentRuntime.step超过maxSteps时先置forceFinish，推动最终回答路径；不是在该判断点直接抛错终止。

事实边界：
- 状态锁/恢复有实现，不代表本次只读审计验证真实Redis、多实例和私有队列行为。

### A08 单题/线程评分解析与状态回写

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:1419` — `AgentEvalRunService.evaluateCase`（definition）。
- `src/server/services/agentEvalRun/index.ts:698` — `AgentEvalRunService.evaluateThread`（definition）。
- `src/server/services/agentEvalRun/index.ts:1360` — `AgentEvalRunService.evaluateOutput`（definition）。

实际调用/计算位置：
- `src/server/services/agentEvalRun/index.ts:756` — `线程消息查询`（call）。
- `src/server/services/agentEvalRun/index.ts:1442` — `Topic消息查询`（call）。

上游：recordTrajectoryCompletion/recordThreadCompletion。下游：eval-rubric.evaluate；RunTopic/Thread结果。

已核实事实：
- 两路均取范围内最后一条非空assistant正文作为actual；没有assistant输出按error处理。
- 评分优先级是TestCase.evalMode→Dataset.evalMode→Benchmark.rubrics；evalConfig以非null的TestCase整份覆盖Dataset，不逐字段继承。
- external模式进入待外部评分状态；规则/Judge错误与正常答错分别写error/failed，并保存scoringSource及错误代码。

事实边界：
- 直接库evaluate有无rubric时contains兜底，但evaluateCase对空effectiveRubrics提前return；不同层次不能合并讲成同一个默认。
- 只有Agent的最后assistant正文进入该评分入口，不能说已经做全轨迹语义评分。

### A09 Rubric库的加权评分定义

定义/判定位置：
- `packages/eval-rubric/src/evaluate.ts:45` — `evaluate`（definition）。
- `packages/eval-rubric/src/matchers/index.ts:22` — `match`（definition）。

实际调用/计算位置：
- `packages/eval-rubric/src/evaluate.ts:138` — `计算加权score`（calculation）。

上游：evaluateCase/evaluateThread/其他库消费者。下游：extractors；各matcher；EvaluateResult。

已核实事实：
- 按rubric extractor抽取actual后匹配；expected是JSON候选数组时逐候选匹配并取最佳分。
- 总分=Σ(weight_i*score_i)/Σweight_i；总passed=score>=passThreshold，默认0.6。
- 存在有限数值、非负权重、至少正权重、空/非字符串候选和非法regex等防护。

事实边界：
- 总阈值与单rubric阈值是不同层次。service读run.config.passThreshold，但当前Run创建API的用户输入schema未公开该字段。
- 库支持的枚举声明与真正match switch分支要区分，不能只看类型名宣称所有类别已有算法。

### A10 LLM Judge上下文与硬截止时间

定义/判定位置：
- `src/server/services/agentEvalRun/judge.ts:27` — `generateJudgeObject`（definition）。
- `packages/eval-rubric/src/matchers/llmRubric.ts:26` — `buildJudgeUserPrompt`（definition）。
- `packages/eval-rubric/src/matchers/llmEq.ts:54` — `matchLLMEq`（definition）。

实际调用/计算位置：
- `src/server/services/agentEvalRun/index.ts:1387` — `evaluateOutput → generateJudgeObject`（call）。

上游：eval-rubric matcher注入generateObject callback。下游：initModelRuntimeFromDB；ModelRuntime.generateObject；scoringSource/errorCode。

已核实事实：
- llm-rubric发送Question/Output/Criteria及非空Expected、choices/category；criteria优先，judgePrompt为旧别名。
- Judge需显式model/provider；answer-relevance按二值0/1，llm-rubric按0..1连续分；合法0分不丢失。
- timeoutMs整数100..60000、默认60000，race覆盖初始化，abort请求取消；空JSON/解析失败、非法分数、空reason、provider失败分型。

事实边界：
- service adapter严格拒绝无效结果；单独调用llm-rubric matcher仍保留旧clamp兼容行为。
- 本轮只读未调用真实Judge，不能把存在generateObject或历史Mock验收当真实模型质量证明。
- case覆盖需完整model/provider，未实现偷偷按字段继承；无凭据状态不能推断整个用户DB绝无凭据。

### A11 K次运行如何聚合到单个Case

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:842` — `AgentEvalRunService.aggregateThreadResults`（definition）。

实际调用/计算位置：
- `src/server/services/agentEvalRun/index.ts:904` — `anyPassed`（calculation）。
- `src/server/services/agentEvalRun/index.ts:911` — `bestScore`（calculation）。

上游：recordThreadCompletion收齐线程。下游：RunTopic.score/passed/evalResult.threads。

已核实事实：
- Case passed=任一线程passed；passAllK=全部线程passed；Case score=max(可用线程score)。
- 至少一个通过且另一个线程error时Case仍通过，线程错误保留；无通过且存在error时Case error。
- cost/tokens/duration等主字段为线程平均；totalCost/totalTokens/totalDuration为线程累计。

事实边界：
- 成功概率的统计含义、线程独立性不由该聚合函数证明。
- 这不是把K份线程分数简单平均后决定Case通过；也没有实现组合数的无偏pass@k估计公式。

### A12 Run指标、终态与原子完成

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:1205` — `AgentEvalRunService.evaluateAndFinalizeRun`（definition）。
- `src/server/services/agentEvalRun/orchestrator.ts:419` — `AgentEvalRunOrchestrator.finalizeRun`（definition）。
- `packages/database/src/models/agentEval/run.ts:98` — `AgentEvalRunModel.finalizeIfActive`（definition）。

实际调用/计算位置：
- `src/server/services/agentEvalRun/orchestrator.ts:466` — `finalizeRun → finalizeIfActive`（call）。

上游：K1/K2 local hooks、webhook完成、外部评分/重试流程。下游：Run.metrics/status。

已核实事实：
- passRate=passedCases/全部RunTopic数；averageScore分母为passedCases+failedCases，排除error/timeout/external。
- K>1时passAtK=至少一次通过Case数/全部Case数；passAllK=全部线程通过Case数/全部Case数。
- run.duration=Date.now-startedAt墙钟时间；totalDuration累计执行时长，可与墙钟不同。
- 终态external优先；全部Case为error或timeout则Run failed；其余为completed。completed不等于每题passed。
- finalizeIfActive仅idle/pending/running/external可写，已completed/failed/aborted避免重复finalize变更指标；重试需重新激活。

事实边界：
- finalize聚合函数本身completedCases直接等于RunTopic数，依赖调用门禁确保已完成，不能单凭100%证明所有Case有效评分。
- 某些0值通过truthy条件呈为undefined；未测真实模型费用时不要把缺失成本解释为0费用。
- Run的成本/token/LLM次数来自Agent telemetry；这里的Judge generateObject未把独立usage/cost回填Run.metrics，不能讲成已包含完整Judge开销。

### A13 报告读取与修改后重测

定义/判定位置：
- `src/server/services/agentEvalRun/index.ts:964` — `AgentEvalRunService.getRunDetails`（definition）。
- `src/store/eval/slices/run/action.ts:154` — `useFetchRunDetail`（definition）。
- `src/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/index.tsx:22` — `RunDetail`（definition）。

实际调用/计算位置：
- `src/services/agentEval.ts:147` — `client → agentEval.getRunDetails`（call）。
- `src/routes/(main)/eval/bench/[benchmarkId]/features/RunCreateModal/index.tsx:138` — `RunCreateModal.createRun`（call）。

上游：React页面/Zustand动作/SWR。下游：tRPC agentEval.getRunDetails；Run+Dataset+Topic+TestCase+evalResult。

已核实事实：
- RunDetail活跃时以3000ms轮询详情与结果，完成后展示StatsCards/Charts/CaseResults。
- getRunDetails还会检查running run超时，不是完全无副作用的只读getter。
- 修改Agent配置后新建Run再start可形成另一次评测；错误Case重试是另一条retryRunErrors/retryRunCase路径。

事实边界：
- 报告读取、Agent配置保存和新Run创建是不同API调用。force重启既有Run不会自动创建新的历史版本记录。
- 报告中的targetAgent展示信息也可能从当前Agent重新读；agentSnapshot与当前展示配置应分清。
- force=true放开运行状态门禁，但编排仍过滤待执行Case；它不保证已评分Case完整重跑。新版本完整对照应明确新建Run。

### A14 模型SDK的真实调用位置

定义/判定位置：
- `packages/model-runtime/src/core/ModelRuntime.ts:120` — `ModelRuntime.chat`（definition）。
- `packages/model-runtime/src/core/ModelRuntime.ts:171` — `ModelRuntime.generateObject`（definition）。
- `src/server/modules/ModelRuntime/index.ts:439` — `initModelRuntimeFromDB`（definition）。

实际调用/计算位置：
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts:344` — `call_llm → serverMessagesEngine`（call）。
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts:448` — `call_llm → modelRuntime.chat`（call）。
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:249` — `OpenAI-compatible SDK construction`（call）。
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:841` — `structured response_format`（call）。

上游：RuntimeExecutors.call_llm；generateJudgeObject。下游：Provider runtime；OpenAI JS SDK或其他Provider实现。

已核实事实：
- 普通Agent主要调用ModelRuntime.chat；Judge调用generateObject并传JSON schema。
- 服务器从DB/配置初始化Provider runtime，ModelRuntime包装hooks后转给实际provider runtime（this._runtime）。
- 可直接核查的OpenAI-compatible工厂确实new OpenAI并调用chat.completions；还存在Responses/tool-call结构化分支。

事实边界：
- ModelRuntime是本仓库的适配层，不是GeneralChatAgent，也不是评测Run服务。
- 不能把OpenAI-compatible这一分支等同全部供应商均走同一个SDK/端点；真实供应商可用性本次未验。

### A15 65%压缩从阈值到真实执行链

定义/判定位置：
- `packages/agent-runtime/src/utils/tokenCounter.ts:17` — `DEFAULT_MAX_CONTEXT/DEFAULT_THRESHOLD_RATIO`（definition）。
- `packages/agent-runtime/src/utils/tokenCounter.ts:90` — `getCompressionThreshold`（definition）。
- `packages/agent-runtime/src/utils/tokenCounter.ts:114` — `shouldCompress`（definition）。
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts:331` — `GeneralChatAgent.toLLMCall`（definition）。
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts:711` — `createRuntimeExecutors.compress_context`（definition）。

实际调用/计算位置：
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts:336` — `toLLMCall压缩检查`（call）。
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts:403` — `init/user_input压缩检查`（call）。
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts:827` — `真正调用摘要模型`（call）。
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts:859` — `摘要落库`（call）。

上游：GeneralChatAgent.runner/init及工具结果后toLLMCall。下游：compress_context instruction；buildCompressionPlan/chainCompressContext；compression_result → call_llm。

已核实事实：
- 默认maxContext=128000、ratio=0.65，阈值floor(maxContext*ratio)=83200；触发条件是当前计数>阈值，等于阈值不触发。
- tokenx估算一般文本；assistant优先用已记录totalOutputTokens，另计fileList文本。
- 当前服务器createAgentRuntime只传compressionConfig.enabled（缺省true），未在该构造点传模型窗口；不能描述为已自动读取每个模型的真实上下文上限。
- executor会构造压缩计划，调用压缩模型（未单配时回退主modelRuntimeConfig），生成摘要并finalizeCompression，再进入compression_result继续call_llm。

事实边界：
- 65%是默认触发比，不是把内容压成原文65%的目标比例。
- 检查的是当时state/payload.messages；ContextEngineering之后的最终Provider请求另有注入，因此它是启发式预算而非绝不超限的数学保证。
- 无topic/user/可压缩内容/模型配置时可能skipped；buildCompressionPlan保留部分消息，不能按旧注释讲成一律把所有消息替换成一个摘要。

## 课程编写时必须保留的口径

- 保存Agent快照与按快照运行分开讲；当前源码只证明保存。
- 平台Agent执行、内置评分和独立归因是不同链路；Judge不是自动可信根因判定。
- Case最大分、Run平均分、经验pass@k、严格passAllK的分母和语义分别讲。
- completed表示运行完成，不能讲成全部Case都答对。
- 65%是预算触发比例；模型窗口传递、估算token与真正摘要执行是三个位置。
- 存在类型/配置字段不表示已接入调用，例如maxConcurrency当前未见消费。

精确行号与源文件hash见PLATFORM_FACTS.json。

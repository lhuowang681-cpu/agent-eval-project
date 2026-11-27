# Python归因与平台Trace合同：第二阶段只读审计

日期：2026-11-08。这里是方案证据，未实施桥接、修改业务或调用LLM。入口和规则以第一轮维护版为准，source-reference继续保留原件。只运行了离线纯函数合同探针，见probe-results.json；不把静态可行性称为集成通过。

## 1. 可复用部分与实际缺口

最小路径是“平台按轨迹导出已落库证据 → 原维护版Python CLI批处理 → 结果及证据索引校验 → 独立保存诊断”。保留原评分结果，不先建Python常驻服务，不重写56模块分类器。现成agentEvalExternal不是完整Trace导出接口，也不是独立诊断写入接口。

| 组件 | 真实合同/作用 | 接入限制 |
| --- | --- | --- |
| round1/attribution/structured_jsonl_attribution.py | 匹配part_*.jsonl；顶层id/sessionId/timestamp/input/output；从input提取user/assistant/tool消息、tool_calls；只认结构化失败；输出CSV/JSON/summary/input_errors | 不读取observations/events作为失败节点；不返回原消息node_id；无run/case/thread字段；没有严格输入schema。跨语言适配及证据索引必须补齐 |
| source-reference/attribution/taxonomy.py | 8层56模块，固定module_id与名称 | 这是模块字典，不是完整error_category枚举，不能把所有snake_case都当合法业务类别 |
| trace_denoiser.py | 节点id/parent_id/created_at/error/tools等行转denoised_trace；保留错误、祖先、邻域，最多40节点 | 和JSONL入口不是同一种输入；节点缺ID会生成_row_i，重复ID保留末次；40节点上限仍可裁掉祖先，文本也截断。不能据方法注释宣称总有完整因果链 |
| llm_classifier.py | 可选LLM语义归因；normalize_result校验模块，非法模块回退UNCLASSIFIED | import即load_dotenv；本轮不能直接导入运行。证据ID存在性、语义支持、badcase_kind枚举、original_error_type真实来源都未严格校验 |
| reattribution_validator.py等报表修整脚本 | 按failure/tool/summary关键词更换模块，历史离线报表辅助 | 不等于可信证据验证器；“工具拒绝参数”不能单独证明Agent最早生成错误，更不能从外部500推内部参数错误 |
| requirements.txt | pandas/numpy/matplotlib、Langfuse/OpenAI/dotenv/tqdm等 | 核心维护CLI仅stdlib+pandas。首个批处理不需要装或启动Langfuse/OpenAI，不读取.env或调用网络；不能把全套报表依赖强加给首个接入 |

JSONL入口现识别：4类Provider契约、4类Builtin分支、6类外部失败分支。`tool_source=unknown`现在也落入classify_external且默认模块L6.4，这是旧规则的适用边界，不应在平台接入时把“来源未知”变成“已确定外部原因”。Builtin失败无足够细节时旧规则归L8.3/governance；它只能表达定位不足，不能证明Observability模块真的出错。

输出的input_traces是有效输入行数，不是唯一任务数；failure_events按session+tool_call_id/错误签名去重；failure_topics为有失败的session数。单机接入必须用独立轨迹ID作为sessionId，防止k次轨迹同topic错误合并；UI统计仍通过真实caseId聚合，不能沿用历史effective_trace_id=topic_id即任务数的假设。

## 2. 平台已有证据及身份映射

| 身份 | 已有来源 | 不能做的等同 |
| --- | --- | --- |
| runId | agent_eval_runs.id | 不是operationId，也不等于Langfuse traceId |
| caseId | agent_eval_test_cases.id，经agent_eval_run_topics.testCaseId关联 | 诊断一个case需要runId限定配置/该次运行，不能只按caseId取历史消息 |
| topicId | agent_eval_run_topics的runId+topicId主键 | k>1同topic包含多条eval thread；不能将所有消息直接拼成一条轨迹 |
| threadId | threads，eval类型；多次轨迹记录 | 单次k=1可null；null必须显式保留，不捏造数据库thread |
| operationId | k=1：runTopic.evalResult.operationId；k>1：thread.metadata.operationId；agent_operations有topic/thread/parentOperationId | 关系缺失时不得靠ID字符串拆解或时间最近推为确定；重试可能多operation；普通交互式聊天未必有durable operation行 |
| traceId/observationId | messages.traceId/observationId；可选Langfuse createTrace/generation | Langfuse关闭时应为null；一topic可多次模型请求、多trace/observations；不是每个工具执行节点都已有span |
| nodeId | 建议优先真实message.id；事件用operationId+eventId命名空间 | nodeId和tool_call_id不是一回事；合成导出nodeId须明确derived，不伪装Langfuse observation |
| toolCallId | assistant的messages.tools、tool结果message_plugins.toolCallId；插件表还有identifier/apiName/type/arguments/state/error | ID只在其轨迹内使用；相同工具名或时间邻近不是call/result关联证明 |

已有messages表还保存role/content/error/tools/parentId/model/provider/createdAt/messageGroupId等。MessageModel.create在tool角色写message_plugins，并把tool_call_id落入toolCallId。工具名应复用平台ToolNameResolver/generateToolName规则，保留原工具身份；不能由自由文本关键词或任意拼接制造Builtin/MCP来源。

agentEvalExternal.messagesList只select content/createdAt/id/role/threadId/topicId，且排除所有messageGroupId非空消息；它没有tools/error/parentId/traceId/plugin身份，不能直接满足归因。对topic不带thread查询还会混入所有轨迹；排序只createdAt没有并列时的可靠序号。因此首个导出应复用MessageModel或加一个有明确范围的只读导出投影，而非让Python直接查询PG、更非把此瘦接口结果假装完整Langfuse trace。

agent_operations只是轻量状态跟踪行，不是每一步完整日志。流事件另在StreamEventManager，Redis有expire/retention；不保证停止服务或TTL后还能还原。TraceClient由ENABLE_LANGFUSE控制；createTraceOptions记录模型请求messages及completion输出，单个generation也不能替代所有运行/工具/span父子关系。

## 3. 最小可实施跨语言合同（草案，尚未实现）

首个支持边界：单用户、已结束run、k=1、普通主线消息、单机显式命令批处理。输入按轨迹一行，保持维护版入口兼容；同时用sidecar保留平台ID和原始证据，避免把额外字段偷偷塞入input而被extract_messages递归扫成伪消息。

`manifest.json`：schemaVersion=`agent-attribution/v1`、jobId、runId、ownerScope、exportedAt、rulesVersion/hash、exporterVersion、每个文件sha256/行数、每条trajectoryKey与真实runId/caseId/topicId/threadId/operationIds/traceIds、coverage及缺失原因。Owner为本地授权范围，不输出用户凭据。

`part_000.jsonl`每条：

```json
{
  "id": "derived:trajectory:<export-id>",
  "sessionId": "derived:trajectory:<export-id>",
  "timestamp": "2026-11-08T00:00:00Z",
  "input": [
    {"role":"user","content":"原用户问题"},
    {"role":"assistant","tool_calls":[{"id":"原call-id","function":{"name":"原工具全名","arguments":"原参数JSON字符串"}}]},
    {"role":"tool","tool_call_id":"原call-id","content":"{\"success\":false,\"error\":\"原结构化错误\"}"}
  ],
  "output": {}
}
```

这里id/sessionId明确是兼容入口的派生轨迹身份，不是声称存在Langfuse trace；真实平台关系在manifest。output只允许实际Provider/runtime输出，不能把工具错误挪过去重复归因。无Provider输出时留空，不编造错误。现结构化DB error若需适配为success=false envelope，必须记录“由真实error字段生成”的变换和源指针，不把正文里提到error字样当失败。

`evidence.jsonl`每个节点至少：`nodeId/sourceKind/sourceId/trajectoryKey/runId/caseId/topicId/threadId/operationId?/traceId?/parentNodeId?/role/order/createdAt/toolCallId?/toolIdentity?/content/error/rawSha256/redaction/truncation`。order来自持久顺序；只有createdAt并列时标order_uncertain，不伪造严格先后。parentNodeId可缺，但要记录missing-parent，不用邻近节点代替真实parent。工具名称类型用真实manifest/plugin映射，未知就unknown。文件可包含脱敏后的原文和源字段JSON Pointer；哈希对脱敏前/后哪个版本计算必须说清。

`findings.json`外层合同：

```json
{
  "schemaVersion":"agent-attribution/v1",
  "jobId":"job-id",
  "trajectoryKey":"derived:trajectory:<export-id>",
  "analysisStatus":"abstain",
  "coverage":{"messages":"complete","toolPairs":"incomplete","operationEvents":"unavailable","providerRequest":"unavailable"},
  "observations":[],
  "findings":[],
  "reasonCodes":["missing_tool_result_identity"],
  "errors":[]
}
```

analysisStatus仅`ok|abstain|error`：ok允许0发现，但必须有足够覆盖；abstain表示来源/关系/责任证据不够，不代表Agent答错；error是导出/进程/JSON/schema等分析器故障，不代表业务失败。观察到真实失败但无法定责，可以保留observation并abstain，不能直接造一个module主因。

finding建议：findingId、category（版本化allowlist）、moduleId（56之一或null）、toolSource（builtin/mcp/plugin/provider_runtime/unknown）、actionability（internal_candidate/external_observed/unknown）、evidenceRefs、evidenceExistence（valid/invalid）、support（supported/insufficient/contradicted）、reason、candidateModules、needsReview。UNCLASSIFIED只作为旧输出兼容哨兵，在新合同映射moduleId=null+abstain，不能计入56模块榜。现JSONL类别名单可作为规则v1 allowlist；LLM自由snake_case不得直接进入同一字典。

两个门禁独立：

1. **证据存在**：ref能在当前job/当前run-case-trajectory的索引解析，源ID、字段指针、内容hash、权限范围匹配；引用别的case即使ID真实也拒绝。
2. **证据支持**：该节点确有结构化失败、call/result身份匹配、来源可确认、当前证据足以支持当前责任命题。外部500能支持“外部调用失败”，不能支持“内部参数生成错误”；Builtin拒绝参数只有在已观察到Agent原始参数且排除中间变换后，才可提升为Agent生成责任。

规则输出首先当候选；现CLI分类不具备这些门禁。桥接层不重写分类器，而是补格式转换/身份索引/保守准入，保留原输出供审计。不能为凑有结论将unknown映射external、将分析器error映射失败任务、把所有定位困难归L8.3。

## 4. 单机批处理集成与保存边界

建议显式命令：受权TS导出 → 临时独立job目录 → 固定Python可执行文件+绝对CLI路径与参数（不拼shell命令） → 超时/退出码/输出schema验证 → 原子发布结果目录。读取summary/input_errors等文件，不将stdout最后一行当唯一协议；维护CLI stdout混有progress。部分坏行必须保留input_complete=false并转外层abstain/partial说明，不能说全批通过。

首个增量只将诊断输出作为独立本地run附件文件（job目录关联run），无需数据库迁移。若后续需要平台页面显示，应新增明确的diagnostic附加字段/附件合同，并保留原evalResult，不直接复用agentEvalExternal.reportResult当诊断写入。

原因：reportResult要求correct/score，会更新passed/failed、rubricScores和run聚合；这属于评分语义。unknown/abstain在此没有合法表达。现接口score还仅z.number()，相同分数/正确性判为幂等时可能忽略诊断文本变化；批量逐条写并非全事务。首个桥接不能用score=0/correct=false来塞未知，也不假设结果有版本、严格幂等或atomic batch。

## 5. 增量2/3验收建议

增量编号按此审计的建议边界，最终以主方案排序为准。

**增量2：可靠导出+本机规则批处理（不写评分）**

- 一次真实规则run的3题从DB导出，manifest可逐层回查run/case/topic；单次轨迹operation关系有来源，缺失可见。正常三题应0已确认失败，不为了展示归因制造问题。
- 另外通过受控本地工具失败运行获得真实落库call/result，导出后原维护CLI能识别观察到的失败；重放同一bundle结果稳定。坏行、空成功、无关工具成功沿用round1回归。
- 任务级计数与事件级计数分别检查：同一case两次相同工具失败事件可2、受影响case仍1；重复导出不放大；不同case即使call id相同也不合并。
- 节点错run/错case、缺callId、孤儿结果、tool来源unknown、原文截断到缺失败字段、无operation/span、分析器超时/退出非0逐项返回abstain/error及原因，不能伪造根因。
- 回归原评分与run终态不变；源bundle和脚本hash可查，未读真实密钥、未联网调用LLM。

**增量3：证据门禁+可查看诊断附件**

- 任意伪造node id直接拒绝；存在但跨case的ID同样拒绝；节点存在却仅有外部500时，拒绝“Agent生成参数错误”的责任命题。存在性与支持性分别记录，不用confidence替代。
- 56模块之外值、非法category/kind/actionability、无穷/NaN confidence、伪造original_error_type均拒绝或保守abstain，不能静默修成“高置信”。保留正常规则类别兼容测试。
- 页面只展示通过门禁的观察/候选/证据链接，明确未定责；原passed/score、Agent snapshot和三题报告不变。附件重跑同job不重复，bundle/rules版本变化生成新结果可追溯。
- k>1/多operation在首个范围外就明确拒绝；若要开放，必须新增分轨迹case聚合、thread范围校验和重试不串线测试后再声称支持。

## 6. 本轮离线探针与尚未得到的Trace

probe_contracts.py用AST仅提取normalize_result纯定义和字典，避免导入dotenv/OpenAI；无网络。实测固定模块数56，非法模块回退UNCLASSIFIED；但高confidence+不存在的missing-node仍保留且needs_review=false，非法badcase_kind原样保留，模型提供的FabricatedError覆盖ActualError。见probe-results.json，不宣称语义模型评测。

尚缺：真实失败工具的完整端到端导出样本、实际message.tools形状/插件映射覆盖、跨重试operation归属、并列时序可靠来源、压缩组消息纳入策略、Provider请求变换前后证据、Redis过期后的步骤快照、全部Langfuse spans父子链及与消息对应。这里未连接第二阶段实时DB/模型，不能保证这些数据已完整存在。开始实施前用一条真实成功与一条受控失败轨迹确认映射，再冻结v1合同。

审计依据（项目内路径）：round1维护入口；source-reference/attribution/{taxonomy,llm_classifier,trace_denoiser,reattribution_validator,ASSUMPTIONS_SINGLE_TRACE,requirements}；platform/packages/database/src/schemas/{agentEvals,message,agentOperation}.ts；platform/packages/database/src/models/message.ts:create；platform/src/server/routers/lambda/agentEvalExternal.ts；platform/src/server/services/agentEvalRun/index.ts:runTestCase/runThreadTrajectory；platform/src/server/services/aiAgent/index.ts:execAgent；platform/src/server/modules/ModelRuntime/trace.ts；platform/src/server/modules/AgentRuntime/StreamEventManager.ts；platform/src/libs/traces/index.ts。platform均位于local_checks/2026-11-08_platform_audit/platform。本轮仅审计，未编辑这些源码。

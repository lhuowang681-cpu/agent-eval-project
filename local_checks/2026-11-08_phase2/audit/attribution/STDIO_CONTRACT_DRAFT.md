# 增量2/3 stdin/stdout合同补充（按主方案调整，待冻结后实施）

主方案已选择JSON stdin/stdout、平台固定spawn和独立diagnosis API。AUDIT.md中的文件批处理是只读审计时给出的首个可行接入方向；以本补充的单次子进程合同为当前对齐方案，不需要再让TS适配两种公开协议。原CLI仍作为参考与回归证据。

## 输入schemaVersion=1

外层：`schemaVersion:1, scope, nodes, evaluation`。stdin一个完整JSON对象，UTF-8，无dotenv，无模型凭据，无网络。正常stdout严格一个JSON对象+换行，不混进度；日志只stderr。TS在spawn前限制输入字节/节点数/内容长度，传超时和固定执行路径，Python不接受任意脚本/模块路径。

`scope`采用主方案：runId/caseId/topicId为必填非空；threadId和operationId可null，traceIds为字符串数组（缺trace是[]）。caseId指testCaseId，必须由TS确认runTopic从属，不能由Python猜关系。一个请求只包含一条已确定轨迹；k>1先由TS逐thread拆开。多operation若无法唯一关联就不填operationId并标coverage缺失，不能用最早或最近一个假装唯一。

`nodes`：id唯一非空；messageId?；role；content为字符串；parentId?；toolCallId?；toolSource枚举builtin/mcp/plugin/unknown；toolName?；arguments?；error?；traceId?。约束建议：

- id是TS分配的规范证据ID，Python原样使用，不能生成不存在的evidence引用；派生call节点也由TS创建并指回真实messageId及tools字段路径。
- parentId若不在输入中，标dangling_parent，不能静默接到相邻节点。工具call/result必须同toolCallId、同scope配对；缺失/冲突记录unknown，不用toolName相同代替配对。
- toolSource以TS真实manifest/plugin类型为准，不凭名称后缀覆盖；unknown不得落入external_uncontrollable。role=system只作证据范围/覆盖记录，不扫描其正文的错误词。角色缺失或不合法必须拒绝，不能忽略后伪称0错误。
- error保留源结构；只有明确非空真实error/结构化失败标志才是失败观察。参数字串合法或工具返回500，分别只证明相应事实。error来源字段建议sourcePointer或provenance作可选扩展，便于审计。
- createdAt?/sequence?及coverage?建议作为可选扩展：现合同没有可靠顺序字段，只可保留TS数组顺序且标明其可靠性。恢复判断若不能证明“失败后同轮次重试”，必须unknown；默认不启用旧confirmed_retry的时间推断。

`evaluation`：status/score/expected/actual/task/criteria来自原评分/题目，仅读不修改。score应number|null且有限合法；状态需与error/timeout区分。evaluation.status=failed不能单独证明内部模块错误；无工具/Provider失败信号也不意味着quality case没有问题。expected/actual/criteria的语义判断在首个规则适配中保守unknown，禁止用字符串重合冒充因果判断。

## 输出

建议最小形状：

```json
{
  "schemaVersion":1,
  "scope":{"runId":"run","caseId":"case","topicId":"topic","threadId":null,"operationId":null,"traceIds":[]},
  "jobExecution":{"status":"completed","errors":[]},
  "diagnosis":{
    "status":"unknown",
    "category":null,
    "moduleId":null,
    "claimLevel":"observation",
    "summary":"未获得可确认根因的证据",
    "evidenceRefs":[],
    "candidates":[],
    "reasonCodes":["no_supported_failure_signal"]
  },
  "observations":[],
  "coverage":{"toolPairs":"unknown","providerPayload":"unavailable","operationEvents":"unavailable"},
  "provenance":{"rulesVersion":"round1-structured-v1","sourceSha256":"实现时冻结原件hash"}
}
```

jobExecution.status=`completed|failed`表示分析器执行，绝不复用task状态；failed附code/stage/message，不带任何API key、环境变量或输入原文。diagnosis.status按主方案`resolved|unknown|needs_review|error`，其中resolved固定解释为“当前归因命题已有支持”，不是“用户任务已恢复”。业务恢复另作`recovery.status=unknown|tool_retry_succeeded`，不得从resolved推recovered。

建议claimLevel区分observation/root_cause。外部500可形成已支持的observation，不能形成“Agent内部参数错误”的root_cause；若UI只支持根因结论，整体diagnosis应needs_review/unknown并将失败放observations。不能靠module L2.2、confidence高或证据ID存在自动变resolved。

category仅使用维护版已有14个确定规则类别（4 Provider+4 Builtin+6 external）；未知为null，不新增自由snake_case进入同一榜。模块只56字典合法值或null。旧UNCLASSIFIED映射null。error/abstain/unknown是诊断或执行状态，不是伪装的错误类别。

evidenceRefs建议对象数组`{nodeId,field?,quote?,claim?}`；TS按scope验证存在性、字段来源和脱敏版本，Python规则审核支持性。quote必须能在原节点对应字段定位，不允许任意摘要充当逐字引文。存在但无语义支持的证据应保留审核结果并降级needs_review，而非删证据后仍resolved。

## 最小复用和文件边界

准备复制维护版的纯规则函数到platform/scripts/eval-attribution内独立stdlib模块，保留原名/注释及来源路径/hash：decode、flatten、parse_obj、norm、pick、failure_envelope、tool_source（仅兼容参考，平台实际source优先）、classify_builtin、classify_external和PROVIDER_CONTRACTS。confirmed_retry在未带有可靠顺序/轮次合同前不调用。原scan依赖JSONL目录、pandas/main输出，无需复制。

适配层把TS节点转为规则需要的工具名/参数/结构化失败，只在真实error字段有值时生成兼容envelope，并保留变换记录。规则函数只产生候选/观察，不直接授予root_cause.resolved。对unknown source、Builtin拒参、Provider契约缺少生成方证据等场景，保留分类但降级责任结论。这样既复用已测规则，又不继承旧输出的过度定责。

增量2先实现可重复stdin/stdout分析与14类规则兼容回归、正常成功unknown/坏输入jobError、source unknown不冒充external、两case同callId不串线；不写评分。增量3再将“证据存在/同scope”和“证据支持责任命题”分开审核，增加伪造ID、跨case、引用合法但外部500不支持内部归因、非法字典和真实字段被模型输出覆盖等反例。涉及LLM语义分类一律延后，不运行llm_classifier.classify_single。

实施尚待主agent冻结代码基线和分配目录，本轮只交付设计。

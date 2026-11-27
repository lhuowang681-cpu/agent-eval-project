"""TripYoYo Agent Badcase 固定归因树：8 层、56 个叶子模块。"""
from __future__ import annotations

LAYER_NAMES = {
 "L1":"接入层", "L2":"Agent 编排层", "L3":"状态与事件层", "L4":"上下文工程层",
 "L5":"Model Runtime 层", "L6":"工具执行层", "L7":"Skill 与 Agent 生态层", "L8":"横切关注点",
}

# module_id: (module_name, typical_issues, error_signals)
ROWS = {
"L1.1":("前端 Chat Service","ChatStreamPayload|消息重复或丢失|消息顺序|编辑旧消息|Abort|Model Provider Agent Topic Group 参数|配置覆盖|Trace ID|Payload 不一致","BadRequest|NetworkError|ConnectionAborted|UnknownChatFetchError|TypeError|Error|400"),
"L1.2":("tRPC / API 路由","Schema 校验|缺少字段|路由错误|Method|未到 Agent Runtime|身份解析|CORS|SSRF|私网地址|原始错误丢失","BadRequest|400|Unauthorized|401|Forbidden|403|ContentNotFound|404|MethodNotAllowed|405|InvalidAccessCode|InvalidUserKey|NetworkError|SSRF blocked|is not allowed"),
"L1.3":("Agent Runtime Client","Operation 创建|Operation ID|状态查询|Human Intervention|审批后未恢复|SSE 续传|lastEventId|Client Server 状态不一致","NetworkError|ConnectionAborted|Unauthorized|ContentNotFound|ServerAgentRuntimeError"),
"L2.1":("AgentRuntime","Plan-Execute|Step Count|Max Steps|ForceFinish|Executor|Instruction Type|Cost Token Limit|Interrupt Resume|终态|提前结束|异常吞掉","AgentRuntimeError|ServerAgentRuntimeError|ApplicationRuntimeError|InternalServerError|Error|TypeError|500"),
"L2.2":("GeneralChatAgent","应调用工具未调用|不需要却调用|错误工具|重复 Tool Call|参数语义|Batch|提前 Finish|未 Finish|Result 后未继续|Async 未总结|压缩判断|Supervisor|无意义循环","AgentRuntimeError|ServerAgentRuntimeError|SupervisorDecisionFailed|ToolExecutionError|Wrong Tool Selection|Premature Finish|Repeated Tool Call|Missing Tool Call"),
"L2.3":("InterventionChecker","危险操作漏审批|无害操作卡住|Allow-list|humanIntervention|Dynamic Resolver|Headless|黑名单|跳过无反馈|waiting_for_human","PermissionDenied|ToolExecutionError|PluginFailToTransformArguments|JSON Parse Error"),
"L2.4":("UsageCounter","Input Output Token|Tool 次数|LLM Calls|Cache Read Write Miss|Usage 语义|Cost 单位|价格表|Step Usage|Cost Limit","InsufficientBudgetForModel|FreePlanLimit|SubscriptionPlanLimit|inputCachedTokens=0|totalTokens inconsistent"),
"L2.5":("Instruction Executors","call_llm|call_tool|batch|compress|resolve_aborted|human|exec_task|client_task|finish|Tool Result 丢失或顺序|Message 落库|Stream Event|超时","ToolExecutionError|CreateMessageError|ServerAgentRuntimeError|AgentRuntimeError|StreamChunkError|InternalServerError"),
"L3.1":("AgentStateManager","Redis 断连|State 丢失|跨 Step 消息|并发覆盖|Step Count|Pending Tool|Interruption|Resume|InMemory 差异|Metadata|DB 状态漂移","ServerAgentRuntimeError|AgentRuntimeError|InternalServerError|NetworkError|Redis Error|state == null"),
"L3.2":("StreamEventManager","Chunk 顺序重复丢失|stream_end|agent_runtime_end|Tool End|Redis Stream|TTL|MAXLEN|SSE 恢复|UI Loading|内部完成 UI 未结束","StreamChunkError|ConnectionAborted|NetworkError|InternalServerError|Redis Stream Error"),
"L3.3":("AgentRuntimeCoordinator","StateManager EventManager|Step Result|Terminal State|结束事件|重复 runtime_end|Previous State|保存与事件不一致|初始化事件","ServerAgentRuntimeError|InternalServerError|AgentRuntimeError|status running too long"),
"L3.4":("QueueService","QStash|本地队列|Step 未入队|重复执行|幂等|Delay|Payload|进程重启|健康检查|Heartbeat|Watchdog|CAS Resume|顶层卡死","GatewayTimeout|BadGateway|ServiceUnavailable|NetworkError|ServerAgentRuntimeError|ConnectionAborted|heartbeat missing|duplicate step"),
"L3.5":("Snapshot Store","Snapshot 缺失|写入失败|体积|实时 State 不一致|重建 Message|字段裁剪|脱敏|无法复现","InternalServerError|Error|TypeError|Payload Too Large|Snapshot Store Error"),
"L4.1":("MessagesEngine","Provider Processor 未执行或重复|Phase 顺序|Pipeline Abort|消息数异常|重复上下文工程|Metadata 不完整","AgentRuntimeError|BadRequest|TypeError|ExceededContextWindow"),
"L4.2":("ContextEngine","Processor 超时或异常|Pipeline 中止|isAborted|Duration|Metadata 覆盖|输出为空","AgentRuntimeError|InternalServerError|TypeError|PipelineError"),
"L4.3":("System 段注入器组","SystemRole|EvalContext|Date|Memory|Group|Discord|GTDPlan|Knowledge|AgentDocument|ToolDiscovery|Builder|SkillContext|ToolSystemRole|HistorySummary|ForceFinish|重复缺失|过长|Cache 失效","ExceededContextWindow|BadRequest|AgentRuntimeError|cache read drop|system hash changed"),
"L4.4":("Messages 段注入器组","SelectedSkill|PageSelections|PageEditor|GTDTodo|TopicReference|Slash Skill|Topic Summary|User Message 重复包装|动态上下文过大","BadRequest|ExceededContextWindow|AgentRuntimeError|user message hash changed"),
"L4.5":("消息变形处理器组","HistoryTruncate|InputTemplate|Placeholder|Council Group Task Flatten|Supervisor Role|Orchestration Filter|Reaction|MessageContent|ToolCall|ToolMessageReorder|Cleanup|MIME Base64|Role 顺序字段","BadRequest|StreamChunkError|PluginFailToTransformArguments|AgentRuntimeError|ExceededContextWindow"),
"L4.6":("Tools 段引擎","Tools 顺序|动态发现 Cache Miss|Function Name|Dedup|Manifest API|Remote Device|ForceFinish|Schema 过大|重复 Tool","BadRequest|ToolExecutionError|PluginFailToTransformArguments|nonexistent tool|cache read zero"),
"L4.7":("Skill 引擎","Skill 清单|Manual Mode|Desktop-only|Sandbox Skill|Identifier|顺序|Meta Runtime|激活结果未回填","ContentNotFound|ToolExecutionError|skill unavailable|selected skill mismatch"),
"L5.1":("ModelRuntime 外壳","beforeChat|Budget|onChatFinal|Cost Hook|onChatError|初始化|Trace 生命周期","AgentRuntimeError|ProviderBizError|ServerAgentRuntimeError|InsufficientBudgetForModel"),
"L5.2":("ModelParamsResolver","enabledContextCaching|Thinking|Reasoning Budget|Adaptive Thinking|Effort|Verbosity|Unsupported 参数","BadRequest|ProviderBizError|InvalidOllamaArgs|cache tokens zero"),
"L5.3":("Provider Factory","Anthropic OpenAI Compatible|RouterRuntime|初始化|API Key|Base URL|错误 Provider|handlePayload|Cache Control|Responses Chat|Beta Header|SDK 异常","ProviderBizError|AgentRuntimeError|ModelNotFound|LocationNotSupportError|PermissionDenied|ConnectionCheckFailed|NoCodingPlanError|InsufficientQuota|OllamaServiceUnavailable|OllamaBizError|ComfyUIBizError|ComfyUIServiceUnavailable|ComfyUIEmptyResult|ComfyUIWorkflowError|ComfyUIModelError"),
"L5.4":("Context Builders","OpenAI Anthropic 转换|Tool Use Result 配对|Orphan Result|Assistant Prefill|图片 MIME|Thinking Block|Cache Control Block|System 丢失|空消息","BadRequest|ProviderBizError|ExceededContextWindow|Tool Use IDs without Tool Result|Unsupported image media type"),
"L5.5":("Stream Processors","Chunk 丢失重复|Tool Arguments 拼接|Reasoning 正文混淆|Grounding Citation|提前结束|Usage Chunk|Provider Stream 变化","StreamChunkError|ConnectionAborted|NetworkError|UnknownChatFetchError|TypeError|JSON Parse Error"),
"L5.6":("Usage Converters","Cache Read Write Miss|Anthropic OpenAI Usage|Input Output Token|Pricing|TTL 费率|Currency|Zero Token","usage inconsistent|cache tokens zero|cost mismatch|Usage Conversion Error"),
"L5.7":("Parameter Resolver","temperature 与 top_p|Max Tokens|Sampling|Thinking Budget|Cache TTL|Unsupported 参数","BadRequest|ProviderBizError|InvalidOllamaArgs|ExceededContextWindow|InvalidComfyUIArgs"),
"L5.8":("Model Bank","Model Provider ID|Context Window|Function Calling|Vision Reasoning|Extend Params|Pricing|Alias","ModelNotFound|ExceededContextWindow|ProviderBizError|NoCodingPlanError|ComfyUIModelError"),
"L5.9":("Runtime Map","Provider 未注册|大小写|错误 Runtime|配置未加 Map|Runtime 加载","AgentRuntimeError|ModelNotFound|ProviderBizError|Runtime is undefined"),
"L6.1":("ToolExecutionService","Executor|Identifier API Name|参数校验|Timeout|执行后端|返回格式|Builtin MCP Plugin 路由","ToolExecutionError|PluginFailToTransformArguments|BadRequest|ContentNotFound"),
"L6.2":("BuiltinToolsExecutor","Runtime 未注册|Manifest 实现|Server Desktop 差异|Tool State|环境可用性|UI 状态","ToolExecutionError|PermissionDenied|ContentNotFound|BadRequest"),
"L6.3":("MCP Service","Server 启动|Stdio|HTTP 断连|Tool List|Manifest|超时|非法 JSON|进程退出","ToolExecutionError|NetworkError|GatewayTimeout|ServiceUnavailable|ConnectionAborted"),
"L6.4":("Plugin Gateway Service","鉴权|非 2xx|参数转换|Rate Limit|超时|SSRF|响应解析|版本","PluginFailToTransformArguments|Unauthorized|Forbidden|TooManyRequests|GatewayTimeout|BadGateway|ServiceUnavailable|NetworkError|SSRF blocked"),
"L6.5":("Klavis Integration","OAuth Token|Scope|第三方 API|账户绑定|Tool Schema|限流","Unauthorized|PermissionDenied|InvalidAccessCode|NetworkError|ServiceUnavailable|TooManyRequests"),
"L6.6":("Cloud Sandbox","Session|创建|上传下载|依赖安装|命令超时|Credential|Output 文件|环境差异","ToolExecutionError|GatewayTimeout|PermissionDenied|ContentNotFound|ServiceUnavailable"),
"L6.7":("Local System / Remote Device","Device 离线或 ID|文件权限|Working Directory|命令超时|路径|无 Desktop|消息丢失|时间不一致","PermissionDenied|ContentNotFound|GatewayTimeout|SystemTimeNotMatchError|ToolExecutionError"),
"L6.8":("Dynamic Intervention Audits","Resolver|参数 JSON|Dynamic Policy|安全误匹配漏匹配|Headless|Manifest Audit Type","PermissionDenied|ToolExecutionError|PluginFailToTransformArguments|Dynamic Resolver Error"),
"L7.1":("Skill Store & Skill Runtime","Identifier|找不到|导入|Content|URL ZIP 本地方式|Desktop-only|激活结果|重复激活|版本","ToolExecutionError|ContentNotFound|NetworkError|PermissionDenied|Invalid Skill Package"),
"L7.2":("Agent Builder / Agent Management","错误 Agent|配置保存|System Role|Model Provider|Plugin Tool 关联|上下文刷新|Cache Miss|资源清单","ToolExecutionError|BadRequest|ContentNotFound|CreateMessageError"),
"L7.3":("Agent Documents","LoadRules|频繁进出 Prompt|未加载或未更新|On-demand|system-replace|maxTokens|中文截断|Context 超限|Cache","ExceededContextWindow|ContentNotFound|ToolExecutionError|BadRequest|document count mismatch"),
"L7.4":("Agent Tasks / Sub-Agents","子 Task Agent|启动回调|Result|waiting_for_async_tool|Placeholder|Barrier|重复恢复|无 Desktop|Headless 审批|Watchdog","ServerAgentRuntimeError|ToolExecutionError|GatewayTimeout|ConnectionAborted|ApplicationRuntimeError|CreateMessageError"),
"L7.5":("Group Agent","Speaker|Supervisor|Agent Map|成员信息|消息过滤|Role|Group Context|重复回答","SupervisorDecisionFailed|ServerAgentRuntimeError|AgentRuntimeError|ToolExecutionError"),
"L7.6":("User Memory","召回相关性和数量|未召回|写入|重复|Effort|敏感信息|Cache|Context 超限","ToolExecutionError|ExceededContextWindow|ContentNotFound|Memory Search Empty|Memory Write Failed"),
"L7.7":("Knowledge Base","Embedding|索引|召回相关性|TopK|阈值|挂载|漏召回|重复 Chunk","ProviderBizError|ConnectionCheckFailed|ContentNotFound|ToolExecutionError|InvalidProviderAPIKey"),
"L7.8":("Web Browsing","搜索引擎|关键词|结果相关性|Crawler 限流|登录墙|内网|SSRF|空内容|Redirect|Citation","NetworkError|TooManyRequests|GatewayTimeout|ContentNotFound|PermissionDenied|SSRF blocked"),
"L7.9":("Notebook & Page Agent","Selection 参数范围|Editor 同步|写回|内容过大|Context 重复|错误文档","ToolExecutionError|CreateMessageError|ExceededContextWindow|ContentNotFound"),
"L7.10":("Chat Adapter","飞书 Discord|消息解析|Webhook 重复|用户频道映射|回复|附件引用|Headless|限流|签名","Unauthorized|PermissionDenied|NetworkError|ApplicationRuntimeError|ToolExecutionError|TooManyRequests"),
"L8.1":("数据库层","消息漏落|Parent ID|Tool 成功 Message 未落库|Operation Row|Heartbeat|Migration|慢查询|并发覆盖|事务|连接池","CreateMessageError|ServerAgentRuntimeError|InternalServerError|ContentNotFound|Database Error"),
"L8.2":("认证与鉴权","Token 过期刷新|OIDC Callback|Session 跨设备|权限|凭证解密|Access Code","Unauthorized|Forbidden|InvalidAccessCode|InvalidUserKey|PermissionDenied"),
"L8.3":("Observability","Trace ID|Parent Child|Span 缺失|只写日志|Generation 状态|Tool Span|指标|Snapshot 关联|重复上报|过度脱敏|证据不足","Error|TypeError|InternalServerError|Trace Export Error|Span Export Error|Error Type missing"),
"L8.4":("消息队列","Step 重复或未消费|QStash|Retry|Delay|Payload|Schedule|Queue 不可用","NetworkError|GatewayTimeout|BadGateway|ServiceUnavailable|InternalServerError"),
"L8.5":("Redis 层","连接池|断连|State TTL|Stream TTL|发布|消费滞后|DB 漂移|错误回退 InMemory","NetworkError|ServiceUnavailable|InternalServerError|Redis Timeout|Redis Connection Error"),
"L8.6":("Credentials 管理","API Key|OAuth Token Scope|Bedrock Vertex GitHub|错误 Provider|敏感信息|SSRF 过严过松","InvalidProviderAPIKey|InvalidUserKey|InvalidAccessCode|InvalidBedrockCredentials|InvalidVertexCredentials|InvalidGithubToken|InvalidGithubCopilotToken|NoOpenAIAPIKey|Unauthorized|Forbidden|PermissionDenied|SSRF blocked|SubscriptionKeyMismatch"),
"L8.7":("File Service","上传下载|不存在|PDF Word Excel|截断|MIME|对象存储|临时 URL|图片转换","ContentNotFound|GatewayTimeout|ToolExecutionError|ComfyUIUploadFailed|ProviderNoImageGenerated"),
"L8.8":("Eval 评测","Dataset|Expected Output|Case 执行|Tool Mock|Eval Context|环境差异|Judge 随机性|Rubric|Matcher|Regex JSON Schema|评分波动|回归|Judge 漂移","ProviderBizError|ModelNotFound|InvalidProviderAPIKey|QuotaLimitReached|BadRequest|StreamChunkError|NetworkError|GatewayTimeout|TypeError|invalid judge output|Same Output Different Score"),
"L8.9":("OpenAPI 层","chat completions|responses|Messages Role|Tools Tool Choice|Arguments 字符串|Response Format|SSE data|DONE|Finish Reason|Usage|input output choices|Function Call Output|类型化流事件|API Mode Endpoint","BadRequest|MethodNotAllowed|ProviderBizError|StreamChunkError|UnknownChatRequestError|400|405"),
}

TAXONOMY = {}
for module_id, (name, issues, errors) in ROWS.items():
    layer_id = module_id.split(".")[0]
    TAXONOMY.setdefault(layer_id, {"name":LAYER_NAMES[layer_id], "modules":{}})
    TAXONOMY[layer_id]["modules"][module_id] = {
      "name":name,
      "issues":[x.strip() for x in issues.split("|") if x.strip()],
      "error_types":[x.strip() for x in errors.split("|") if x.strip()],
    }

def get_flat_modules():
    return [{"layer_id":lid,"layer_name":layer["name"],"module_id":mid,**m}
      for lid,layer in TAXONOMY.items() for mid,m in layer["modules"].items()]

def get_module_by_id(module_id):
    return next((m for m in get_flat_modules() if m["module_id"] == module_id), None)

def taxonomy_to_prompt_str():
    return "\n".join(f"{m['module_id']} {m['name']}｜问题：{'、'.join(m['issues'])}｜信号：{'、'.join(m['error_types'])}" for m in get_flat_modules())

def validate_taxonomy():
    expected={"L1":3,"L2":5,"L3":5,"L4":7,"L5":9,"L6":8,"L7":10,"L8":9}
    actual={k:len(v["modules"]) for k,v in TAXONOMY.items()}
    assert actual == expected, (actual, expected)
    assert len(get_flat_modules()) == 56
    return True

if __name__ == "__main__":
    validate_taxonomy(); print("taxonomy ok: 8 layers, 56 fixed modules")

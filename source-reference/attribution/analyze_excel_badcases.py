"""Analyze uploaded TripYoYo error workbook by fixed 8-layer taxonomy.
Uses evidence-first LLM-authored decision rules derived from the active skill taxonomy.
Unit of analysis: effective_trace_id (one primary attribution per trace).
"""
from __future__ import annotations
import os, json, re
from pathlib import Path
import pandas as pd

SRC=Path(os.environ["SOURCE_XLSX"])
OUT=Path(os.getenv("ANALYSIS_OUTPUT_DIR","output/real_analysis"))
OUT.mkdir(parents=True,exist_ok=True)
REVIEW_THRESHOLD=.72
LAYER_NAMES={"L1":"接入层","L2":"Agent 编排层","L3":"状态与事件层","L4":"上下文工程层","L5":"Model Runtime 层","L6":"工具执行层","L7":"Skill 与 Agent 生态层","L8":"横切关注点"}
MODULE_NAMES={
"L1.1":"前端 Chat Service","L1.2":"tRPC / API 路由","L1.3":"Agent Runtime Client",
"L2.1":"AgentRuntime","L2.2":"GeneralChatAgent","L2.3":"InterventionChecker","L2.4":"UsageCounter","L2.5":"Instruction Executors",
"L3.1":"AgentStateManager","L3.2":"StreamEventManager","L3.3":"AgentRuntimeCoordinator","L3.4":"QueueService","L3.5":"Snapshot Store",
"L4.1":"MessagesEngine","L4.2":"ContextEngine","L4.3":"System 段注入器组","L4.4":"Messages 段注入器组","L4.5":"消息变形处理器组","L4.6":"Tools 段引擎","L4.7":"Skill 引擎",
"L5.1":"ModelRuntime 外壳","L5.2":"ModelParamsResolver","L5.3":"Provider Factory","L5.4":"Context Builders","L5.5":"Stream Processors","L5.6":"Usage Converters","L5.7":"Parameter Resolver","L5.8":"Model Bank","L5.9":"Runtime Map",
"L6.1":"ToolExecutionService","L6.2":"BuiltinToolsExecutor","L6.3":"MCP Service","L6.4":"Plugin Gateway Service","L6.5":"Klavis Integration","L6.6":"Cloud Sandbox","L6.7":"Local System / Remote Device","L6.8":"Dynamic Intervention Audits",
"L7.1":"Skill Store & Skill Runtime","L7.2":"Agent Builder / Agent Management","L7.3":"Agent Documents","L7.4":"Agent Tasks / Sub-Agents","L7.5":"Group Agent","L7.6":"User Memory","L7.7":"Knowledge Base","L7.8":"Web Browsing","L7.9":"Notebook & Page Agent","L7.10":"Chat Adapter",
"L8.1":"数据库层","L8.2":"认证与鉴权","L8.3":"Observability","L8.4":"消息队列","L8.5":"Redis 层","L8.6":"Credentials 管理","L8.7":"File Service","L8.8":"Eval 评测","L8.9":"OpenAPI 层"}

def parse_raw(raw):
    try: d=json.loads(raw) if isinstance(raw,str) and raw.strip() else {}
    except Exception: d={}
    body=d.get("body",{}) if isinstance(d,dict) else {}; body=body if isinstance(body,dict) else {}
    err=body.get("error",{}); err=err if isinstance(err,dict) else {}
    return body,err

def evidence(row):
    body,err=parse_raw(row.get("error_raw"))
    vals=[row.get("error_message"),body.get("name"),body.get("message"),err.get("name"),err.get("type"),err.get("status"),err.get("code"),err.get("message")]
    return " | ".join(str(v) for v in vals if v not in (None,"",float("nan")))

def classify(row, trace_meta):
    et=str(row.get("error_type") or ""); ev=evidence(row); low=(et+" "+ev).lower(); node_count=int(trace_meta.get("node_count",0) or 0)
    # Credentials/auth are earliest when explicit credential binding/token evidence exists.
    if "mcp grant token has expired" in low:
        return "mcp_oauth_token_expired","MCP 授权令牌过期","L6.3",.98,"MCP endpoint 明确返回 grant token expired，需要重新授权"
    if "petaautherror" in low or "no binding found" in low or "missing_peta_key_id" in low or "petakeyid is required" in low:
        return "provider_credential_binding_missing","Provider 凭证绑定缺失","L8.6",.98,"错误明确指出 Peta Key 未绑定或 petaKeyId 缺失"
    if "access to anthropic models is not allowed" in low or ("403 status code" in low):
        return "provider_model_permission_denied","Provider 模型权限不足","L8.6",.90,"Provider 返回模型访问权限拒绝/403"
    if et=="NoCodingPlanError" or "未生效 coding plan" in low:
        return "coding_plan_unavailable","Coding Plan 不可用","L5.3",.95,"Provider Factory/Coding Plan 初始化明确失败"
    # Budget/plan limit
    if "达到当前周期费用上限" in low or "permission_error" in low and "费用上限" in low:
        return "subscription_budget_limit_reached","套餐预算达到上限","L2.4",.98,"错误明确说明 Coding Plan 当前周期费用达到上限"
    # Request params and model routing
    if "no model specified" in low:
        return "model_parameter_missing","模型参数缺失","L5.2",.98,"模型请求中未指定 model"
    if "thinking: invalid type" in low:
        return "thinking_parameter_type_invalid","Thinking 参数类型错误","L5.7",.99,"请求 JSON 中 thinking 为 map，但 Provider 期望 boolean"
    if "rate_limit_error" in low or "engine is currently overloaded" in low or "rate increased too quickly" in low:
        return "provider_rate_limited","Provider 限流或过载","L5.3",.97,"Provider 明确返回 rate_limit/engine overloaded"
    if "data_inspection_failed" in low or "inappropriate content" in low:
        return "provider_content_safety_rejected","内容安全检查拒绝","L5.3",.96,"Provider 数据检查明确拒绝输入内容"
    # Context builders / message normalization
    if "contentblock" in low and "blank" in low or "text content blocks must contain non-whitespace" in low or "role 'assistant' must not be empty" in low:
        return "empty_message_content_block","消息内容块为空","L5.4",.96,"Provider 收到空白 ContentBlock/空 Assistant Message，异常请求在上下文构造阶段形成"
    if "image exceeds 5 mb" in low or "image dimensions exceed" in low:
        return "image_payload_exceeds_provider_limit","图片负载超出限制","L5.4",.97,"Provider Payload 中图片大小或尺寸超过模型限制"
    if et=="ExceededContextWindow" or "prompt is too long" in low or "range of input length" in low:
        # Long recurrent traces suggest history truncation/message transformation failed; evidence cannot isolate injector.
        return "context_window_exceeded","上下文窗口超限","L4.5",.78 if node_count>=50 else .66,f"Prompt 超出模型限制；Trace 节点数 {node_count}，优先怀疑历史截断/消息变形未有效压缩"
    # Streaming/network
    if et=="ConnectionAborted" or "connection aborted during streaming" in low or "read econnreset" in low or "premature close" in low or et=="StreamChunkError" or "stream ended unexpectedly" in low or low.strip().endswith("terminated"):
        if et=="StreamChunkError" or "stream ended unexpectedly" in low:
            return "stream_ended_unexpectedly","模型流异常结束","L5.5",.94,"流解析明确返回 unexpected_end"
        return "stream_connection_aborted","模型流连接中断","L5.5",.88,"错误发生在 Provider 流式传输期间，表现为 network error/ECONNRESET/premature close"
    if et in {"502","504"} or "connection timeout" in low:
        return "provider_gateway_timeout","Provider 网关超时","L5.3",.76,"仅有 502/504 或 upstream timeout，定位到 Provider 调用链但缺少更深错误体"
    # Runtime / tools
    if "operation not found" in low:
        return "agent_operation_not_found","Agent Operation 不存在","L1.3",.98,"Agent Runtime Client 查询/恢复的 Operation ID 不存在"
    if "failed to create tool message" in low:
        return "tool_message_creation_failed","Tool Message 创建失败","L2.5",.98,"Instruction Executor 在创建 Tool Result Message 时明确失败"
    if "cannot read properties of undefined" in low and "tools" in low:
        return "tool_result_shape_invalid","工具结果结构异常","L6.1",.78,"下游读取 tools 字段时对象为空；现有证据无法进一步确认具体 Tool 后端"
    if "result is not defined" in low:
        return "tool_execution_result_undefined","工具执行结果未定义","L6.1",.80,"运行时明确出现 result 未定义，发生在工具结果处理链"
    if "unexpected token '<'" in low and "not valid json" in low:
        return "tool_endpoint_returned_html","工具端点返回 HTML","L6.3",.84,"Tool/MCP HTTP endpoint 返回 HTML，客户端按 JSON 解析失败"
    if "signal is aborted without reason" in low:
        return "tool_execution_user_aborted","工具执行被用户中止","L2.5",.92,"内容明确为 Tool execution was cancelled by user"
    if "failed to fetch" in low:
        return "api_fetch_failed","API Fetch 失败","L1.2",.62,"只有 TRPCClientError/Failed to fetch，缺少响应体，需人工复核路由或网络根因"
    # Explicit no-body errors are observability gaps, per user rule.
    if "400 status code (no body)" in low or (et=="ProviderBizError" and not ev.strip()) or et=="UnknownChatFetchError":
        return "provider_error_body_missing","Provider 错误体缺失","L8.3",.95,"仅记录通用错误类型或 HTTP 400，缺少可定位根因的 Error Body"
    if et=="ProviderBizError" and "413" in low:
        return "provider_request_entity_too_large","请求实体过大","L5.4",.88,"Provider 网关返回 413，请求 Payload 过大"
    if et=="500":
        return "internal_error_details_missing","内部错误详情缺失","L8.3",.75,"仅有 HTTP 500 且缺少可定位的响应详情"
    return "unclassified_runtime_error","未分类运行错误","UNCLASSIFIED",.35,"现有 Trace 证据不足以稳定定位固定模块"

events=pd.read_excel(SRC,sheet_name="ERROR_EVENTS")
manifest=pd.read_excel(SRC,sheet_name="TRACE_MANIFEST").set_index("effective_trace_id")
# Choose most informative event per trace; explicit nested messages beat generic errors.
priority={"ApplicationRuntimeError":6,"ExceededContextWindow":6,"NoCodingPlanError":6,"StreamChunkError":5,"ProviderBizError":4,"ConnectionAborted":3,"504":2,"502":2,"500":2,"UnknownChatFetchError":1}
records=[]
for tid,g in events.groupby("effective_trace_id",sort=False):
    meta=manifest.loc[tid].to_dict() if tid in manifest.index else {}
    scored=[]
    for idx,row in g.iterrows():
        ev=evidence(row); score=priority.get(str(row.get("error_type")),0)+(3 if len(ev)>40 else 0)+(2 if any(k in ev.lower() for k in ["invalid","expired","not found","exceed","permission","no model","econnreset","unexpected"]) else 0)
        scored.append((score,idx,row))
    _,_,row=max(scored,key=lambda x:(x[0],-x[1]))
    cat,zh,mid,conf,reason=classify(row,meta)
    lid=mid.split(".")[0] if mid.startswith("L") else "UNCLASSIFIED"
    all_types=sorted(set(str(x) for x in g.error_type.dropna()))
    all_messages=[str(x) for x in g.error_message.dropna() if str(x).strip()][:5]
    records.append({
      "trace_id":tid,"trace_name":"","trace_timestamp":str(meta.get("first_error_at",row.get("created_at",""))),
      "badcase_kind":"observability_gap" if mid=="L8.3" else "runtime_error",
      "error_category":cat,"error_category_zh":zh,"original_error_type":str(row.get("error_type") or ""),"all_error_types":all_types,
      "error_phase":"","layer_id":lid,"layer_name":LAYER_NAMES.get(lid,"未分类"),"module_id":mid,"module_name":MODULE_NAMES.get(mid,"未分类"),
      "confidence":conf,"needs_review":conf<REVIEW_THRESHOLD or mid in {"L8.3","UNCLASSIFIED"},
      "evidence":[evidence(row)[:500],f"Trace error_events={len(g)}, chain_nodes={int(meta.get('node_count',0) or 0)}"]+[m[:300] for m in all_messages[:2]],
      "reason":reason,"candidate_modules":[],"event_count":len(g),"chain_node_count":int(meta.get("node_count",0) or 0),
      "provider":str(row.get("provider") or ""),"model":str(row.get("model") or ""),"agent_id":str(row.get("agent_id") or "")})

(OUT/"classified_badcases.json").write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding="utf-8")
df=pd.DataFrame(records)
cat=(df.groupby(["error_category","error_category_zh"]).size().reset_index(name="count").sort_values("count",ascending=False)); cat["pct"]=(cat["count"]/len(df)*100).round(1); cat["label"]=cat.error_category_zh+"\n("+cat.error_category+")"
mod=(df.groupby(["module_id","module_name","layer_id","layer_name"]).size().reset_index(name="count").sort_values("count",ascending=False)); mod["pct"]=(mod["count"]/len(df)*100).round(1)
cat.to_csv(OUT/"stat_error_category.csv",index=False,encoding="utf-8-sig"); mod.to_csv(OUT/"stat_module_distribution.csv",index=False,encoding="utf-8-sig")
df[df.needs_review].to_csv(OUT/"manual_review.csv",index=False,encoding="utf-8-sig")
print(f"traces={len(df)} categories={len(cat)} modules={len(mod)} review={int(df.needs_review.sum())}")

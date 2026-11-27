"""候选问题细分、责任边界与证据优先归因。

关键原则：Tool/MCP Error 只是错误暴露位置。只有输入有效且工具自身执行/返回异常时才归 L6；
若 Tool Call 前参数、SQL、工具选择已错误，则归最早制造异常输入的 Agent/上下文/参数模块。
"""
from pathlib import Path
import argparse, collections, json, re
from taxonomy import get_module_by_id

BASE={
 'model_parameter_missing':('模型请求缺少 model','L5.2','ModelParamsResolver','agent_orchestration_actionable'),
 'thinking_parameter_type_invalid':('Thinking 参数类型转换错误','L5.7','Parameter Resolver','agent_orchestration_actionable'),
 'empty_message_content_block':('模型消息内容块为空','L5.4','Context Builders','agent_orchestration_actionable'),
 'tool_endpoint_returned_html':('工具端点返回 HTML/非 JSON','L6.1','ToolExecutionService','agent_orchestration_actionable'),
 'tool_validation_error':('Agent 生成的工具命令或参数不符合契约','L2.2','GeneralChatAgent','agent_orchestration_actionable'),
 'tool_unavailable':('不可用工具仍被暴露或选择','L4.6','Tools 段引擎','agent_orchestration_actionable'),
 'visual_tool_execution_failed':('视觉理解工具执行失败','L6.1','ToolExecutionService','agent_orchestration_actionable'),
 'context_window_exceeded':('上下文构造超过模型窗口','L4.5','消息变形处理器组','agent_orchestration_actionable'),
 'peta_auth_error':('外部应用凭证未绑定','L8.6','Credentials 管理','non_orchestration_dependency'),
 'connection_aborted':('Provider 流式连接中断','L5.5','Stream Processors','external_uncontrollable'),
 'provider_permission':('Provider 账户或模型权限不足','L8.6','Credentials 管理','non_orchestration_dependency'),
 'provider_bad_request':('Provider 请求 Payload 非法','L5.4','Context Builders','agent_orchestration_actionable'),
 'rate_limit_or_quota':('Provider 限流或额度不足','L5.3','Provider Factory','non_orchestration_dependency'),
 'network_or_gateway_failure':('外部网络或网关失败','L6.4','Plugin Gateway Service','external_uncontrollable'),
 'tool_execution_error':('工具执行异常（待从调用输入进一步定位）','L8.3','Observability','attribution_governance'),
}
SQL_RULES=[
 ('sql_table_not_found','SQL 引用不存在的表','L2.2','GeneralChatAgent',r'table not found|nosuchobjectexception|failed to get table'),
 ('sql_unresolved_column','SQL 字段不存在或无法解析','L2.2','GeneralChatAgent',r'unresolved_column|cannot resolve|column .* not found|unknown column'),
 ('sql_unreplaced_variable','SQL 模板变量未替换','L2.2','GeneralChatAgent',r'\$\{[^}]+\}|can not cast literal value'),
 ('sql_syntax_error','Agent 生成的 SQL 语法错误','L2.2','GeneralChatAgent',r'syntax error|sqlsyntaxerrorexception|parseexception|mismatched input'),
 ('sql_timeout','SQL 执行超时','L6.1','ToolExecutionService',r'query reached its timeout|timed out|timeout'),
 ('sql_permission_denied','SQL 数据权限不足','L8.2','认证与鉴权',r'access denied|permission denied|not authorized|unauthorized'),
 ('sql_execution_generic','SQL 执行失败但详情不足','L8.3','Observability',r'execution exit code|sql execution failed'),
]

def refine(x):
    cat=x['category'];low=str(x.get('context','')).lower();signal=x.get('signal','')
    if cat=='sql_execution_failed':
        found=None
        for a,b,m,n,p in SQL_RULES:
            z=re.search(p,low,re.I)
            if z:found=(a,b,m,n,z.group(0));break
        if not found:return None
        cat,zh,mid,mn,signal=found
        action='attribution_governance' if mid=='L8.3' else ('non_orchestration_dependency' if mid in {'L8.2','L8.6'} else 'agent_orchestration_actionable')
    else:
        if cat not in BASE:return None
        zh,mid,mn,action=BASE[cat]
    module=get_module_by_id(mid)
    exposure='Tool/MCP Result' if re.search(r'tool|mcp|sql',cat,re.I) else ('Model/Provider Result' if re.search(r'provider|context|model|thinking|connection',cat,re.I) else 'Trace Error')
    if mid.startswith(('L2','L4','L5')):source='Agent 内部决策、上下文构造或参数转换'
    elif mid.startswith('L6'):source='工具执行或结果解析；仅在调用输入有效时成立'
    elif mid=='L8.3':source='原始证据不足，暂不能把报错位置当作根因'
    else:source='权限、凭证或外部依赖'
    return {**x,'category':cat,'category_zh':zh,'module_id':mid,'module_name':mn,
     'layer_id':mid.split('.')[0],'layer_name':module['layer_name'] if module else '',
     'signal':signal,'error_exposure_node':exposure,'abnormal_input_source':source,
     'attribution_basis':f'错误在 {exposure} 暴露；主归因依据是：{source}。',
     'actionability':action,'needs_causal_review':action in {'needs_causal_review','attribution_governance'},
     'candidate_modules':['L6.1'] if mid in {'L2.2','L4.6','L5.4','L5.7'} else (['L2.2'] if mid.startswith('L6') else [])}

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',default='new_export_precise_classified.json');p.add_argument('--output',default='new_export_refined.json');p.add_argument('--summary',default='new_export_refined_summary.json');a=p.parse_args()
    data=json.loads(Path(a.input).read_text(encoding='utf-8'));rows=[]
    for x in data:
        y=refine(x)
        if y:rows.append(y)
    # 同一 Trace 同类别去重，保留全部不同问题；不再用 else: continue 丢掉非 SQL 问题。
    unique={}
    for x in rows:unique.setdefault((x['trace_id'],x['category']),x)
    rows=list(unique.values());cnt=collections.Counter(x['category'] for x in rows)
    summary=[]
    for cat in cnt:
        q=[x for x in rows if x['category']==cat]
        summary.append({'category':cat,'category_zh':q[0]['category_zh'],'module_id':q[0]['module_id'],'module_name':q[0]['module_name'],'actionability':q[0]['actionability'],'records':len(q),'topics':len({x['topic_id'] for x in q})})
    summary.sort(key=lambda x:(-x['topics'],x['category']))
    Path(a.output).write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8');Path(a.summary).write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'records':len(rows),'topics':len({x['topic_id'] for x in rows}),'categories':len(summary),'modules':len({x['module_id'] for x in rows}),'summary':summary},ensure_ascii=False))
if __name__=='__main__':main()

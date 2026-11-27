"""从错误候选中发现全部问题，而不是只保留序列化文本中最先出现的关键词。

输出一条 Trace 可对应多个候选问题；后续 refine 阶段再判断主根因、责任边界与可解决性。
"""
from pathlib import Path
import argparse, collections, json, re

PATTERNS = [
 ('model_parameter_missing','模型参数缺失',r'No model specified in the request'),
 ('thinking_parameter_type_invalid','Thinking 参数类型错误',r'thinking[^|]{0,180}invalid type|expected a boolean'),
 ('empty_message_content_block','消息内容块为空',r'text content blocks must contain non-whitespace|ContentBlock[^|]{0,180}blank|role[^|]{0,80}assistant[^|]{0,80}empty'),
 ('tool_endpoint_returned_html','工具端点返回 HTML',r'Unexpected token[^|]{0,180}not valid JSON|<html[^|]{0,180}not valid JSON'),
 ('tool_validation_error','工具参数/类型校验失败',r'unknown command[^|]{0,180}|specify at least one of[^|]{0,250}|invalid_argument'),
 ('tool_unavailable','工具不可用',r'Cloud sandbox execution is disabled|execution is disabled'),
 ('visual_tool_execution_failed','视觉理解工具执行失败',r'Visual understanding request failed'),
 ('context_window_exceeded','上下文窗口超限',r'ExceededContextWindow|maximum context length|context window exceeded'),
 ('sql_execution_failed','SQL 执行失败',r'SQL execution failed'),
 ('peta_auth_error','Peta 凭证绑定错误',r'PetaAuthError|No binding found for this appId'),
 ('connection_aborted','模型流连接中断',r'ConnectionAborted|connection aborted during streaming'),
 ('provider_permission','Provider 权限错误',r'ProviderBizError[^|]{0,500}(?:403|Forbidden)|errorCode[^|]{0,80}403'),
 ('tool_execution_error','工具执行错误',r'ToolExecutionError'),
 ('provider_bad_request','Provider 请求被拒绝',r'ProviderBizError[^|]{0,500}(?:400|BadRequest)|BadRequestError'),
 ('rate_limit_or_quota','限流或额度不足',r'TooManyRequests|QuotaLimitReached|InsufficientQuota|rate limit|quota exceeded'),
 ('network_or_gateway_failure','网络或网关失败',r'GatewayTimeout|BadGateway|ServiceUnavailable|NetworkError'),
]

def snippets(candidate):
    # 保留不同扫描器给出的全部片段，避免只观察最后一个 Error。
    return ' | '.join(str(m.get('snippet','')) for m in candidate.get('matches',[]))

def discover(candidate):
    text=snippets(candidate); found=[]
    for priority,(cat,zh,pat) in enumerate(PATTERNS):
        for m in re.finditer(pat,text,re.I|re.S):
            ctx=text[max(0,m.start()-900):min(len(text),m.end()+2600)]
            found.append({'category':cat,'category_zh':zh,'signal':m.group(0),'context':ctx,
                          'position':m.start(),'rule_priority':priority})
            break
    # 同 Trace 同类别只保留一个，但不丢弃其他类别。
    unique={}
    for x in sorted(found,key=lambda z:(z['position'],z['rule_priority'])):unique.setdefault(x['category'],x)
    return list(unique.values())

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',default='specific_error_scan.json');p.add_argument('--output',default='new_export_precise_classified.json');p.add_argument('--summary',default='new_export_precise_summary.json');a=p.parse_args()
    src=json.loads(Path(a.input).read_text(encoding='utf-8'))['candidates'];rows=[];counts=collections.Counter()
    for c in src:
        issues=discover(c)
        for order,x in enumerate(issues,1):
            counts[x['category']]+=1
            rows.append({'trace_id':c['id'],'topic_id':c.get('sessionId') or c['id'],'timestamp':c.get('timestamp',''),
             **x,'candidate_order':order,'all_matches':[m.get('type','') for m in c.get('matches',[])]})
    trace_count=len({x['trace_id'] for x in rows});topic_count=len({x['topic_id'] for x in rows})
    Path(a.output).write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    Path(a.summary).write_text(json.dumps({'counts':counts,'records':len(rows),'traces':trace_count,'topics':topic_count,'multi_issue_traces':sum(v>1 for v in collections.Counter(x['trace_id'] for x in rows).values())},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'records':len(rows),'traces':trace_count,'topics':topic_count,'categories':len(counts),'counts':counts},ensure_ascii=False))
if __name__=='__main__':main()

"""结构化 Langfuse JSONL 归因入口。

核心规则：
1. 只读取真实消息/Provider output，不扫描 System Prompt、Skill、Manifest、源码或规则说明。
2. Tool Result 必须有结构化失败状态才算错误。
3. tool_source=mcp 一律作为外部原因，不进入 Agent 源码榜；tool_source=builtin 才允许继续内部归因。
4. Provider/Runtime 错误必须通过类别证据契约。
5. 按 session + tool_call_id/标准化错误去重。
"""
from __future__ import annotations
from pathlib import Path
import argparse,collections,hashlib,json,re
import pandas as pd

MCP_NAME_RE=re.compile(r'(?:^|____)(?:mcp|[^_]*-mcp)(?:____|$)|____mcp$',re.I)

def decode(v):
 for _ in range(5):
  if not isinstance(v,str):break
  try:v=json.loads(v)
  except:break
 return v

def extract_messages(v):
 v=decode(v);out=[]
 def walk(x):
  if isinstance(x,list):
   for y in x:walk(y)
  elif isinstance(x,dict):
   if str(x.get('role','')).lower() in {'user','assistant','tool'} and ('content' in x or 'tool_calls' in x):out.append(x)
   else:
    for y in x.values():walk(y)
 walk(v);return out

def flatten(v,p=''):
 out={}
 if isinstance(v,dict):
  for k,x in v.items():
   key=f'{p}.{k}' if p else str(k)
   if isinstance(x,(dict,list)):out.update(flatten(x,key))
   else:out[key]=x
 elif isinstance(v,list):
  for i,x in enumerate(v[:30]):out.update(flatten(x,f'{p}[{i}]'))
 return out

def parse_obj(s):
 x=decode(s)
 return x if isinstance(x,(dict,list)) else None

def norm(s,n=3000):return re.sub(r'\s+',' ',str(s or '')).strip()[:n]
def pick(flat,*names):
 names={x.lower() for x in names}
 for k,v in flat.items():
  if k.lower().split('.')[-1] in names and str(v).strip():return str(v)
 return ''

def tool_source(name):
 n=str(name or '')
 if MCP_NAME_RE.search(n):return 'mcp'
 if '____builtin' in n:return 'builtin'
 if 'plugin' in n.lower() or 'klavis' in n.lower():return 'plugin'
 return 'unknown'

def failure_envelope(content):
 obj=parse_obj(content);flat=flatten(obj) if obj is not None else {};reasons=[];low=str(content or '').lower().strip()
 for k,v in flat.items():
  kl=k.lower().split('.')[-1];vl=str(v).lower().strip()
  if kl in {'ok','success'} and vl=='false':reasons.append(f'{k}=false')
  if kl in {'is_error','iserror'} and vl=='true':reasons.append(f'{k}=true')
  if kl in {'status','currentstatus'} and vl in {'failed','error','failure','aborted','rejected'}:reasons.append(f'{k}={v}')
 if re.match(r'^mcp error\b',low):reasons.append('MCP error')
 if re.search(r'\[exit code:\s*[1-9]\d*\]',low):reasons.append('nonzero exit code')
 if re.match(r'^(error|failed|exception)\s*[:：]',low):reasons.append('explicit error prefix')
 return bool(reasons),reasons,flat

PROVIDER_CONTRACTS=[
 ('context_window_exceeded','上下文构造超过模型窗口','L4.5','消息变形处理器组',r'(?:maximum context length|context window exceeded|prompt is too long|exceededcontextwindow)'),
 ('provider_payload_invalid','Provider 请求 Payload 非法','L5.4','Context Builders',r'(?:text content blocks must contain non-whitespace|tool use ids without tool result|assistant message must not be empty)'),
 ('thinking_type_invalid','Thinking 参数类型转换错误','L5.7','Parameter Resolver',r'thinking.{0,300}(?:expected a boolean|invalid type|must be boolean)'),
 ('model_missing','模型请求缺少 model','L5.2','ModelParamsResolver',r'(?:no model specified|model is required|missing model)'),
]

def classify_builtin(tool,content,flat,args):
 msg=' '.join([pick(flat,'message','msg','reason','detail','error'),str(content)[:3500]]).lower();alow=str(args or '').lower()
 if re.search(r'(?:unknown flag|unknown command|invalid_argument|specify at least one of|missing required|required field|expected one of)',msg):
  return ('builtin_tool_contract_invalid','Builtin 工具参数或命令不符合契约','L2.2','GeneralChatAgent','agent_orchestration_actionable','Builtin 工具真实拒绝了本次 Agent 调用参数/命令')
 if re.search(r'(?:execution is disabled|tool unavailable|no such tool)',msg):
  return ('builtin_tool_unavailable','不可用 Builtin 工具仍被暴露','L4.6','Tools 段引擎','agent_orchestration_actionable','运行环境禁用/不存在 Builtin 工具，但 Agent 仍发起调用')
 if re.search(r'(?:not valid json|unexpected token <|content-type text/html)',msg):
  return ('builtin_result_parse_failed','Builtin 工具结果解析失败','L6.2','BuiltinToolsExecutor','agent_orchestration_actionable','Builtin 工具调用后在内部结果解析阶段失败')
 return ('builtin_tool_failure_unclassified','Builtin 工具失败但内部模块证据不足','L8.3','Observability','attribution_governance','已确认 Builtin 工具真实失败，但 Error Body 不足以定位内部源码模块')

def classify_external(tool,content,flat,source):
 msg=' '.join([pick(flat,'message','msg','reason','detail','error'),str(content)[:3500]]).lower()
 if re.search(r'(?:no privileges|permission denied|access denied|forbidden|not authorized|unauthorized)',msg):cat,zh='external_permission','外部工具权限不足'
 elif re.search(r'(?:no binding found|credential|api key|token expired|invalid token)',msg):cat,zh='external_credential','外部工具凭证或绑定异常'
 elif re.search(r'(?:quota|rate limit|too many requests|insufficient budget)',msg):cat,zh='external_quota','外部工具额度或限流'
 elif re.search(r'(?:request timed out|query reached its timeout|mcp error -32001)',msg):cat,zh='external_timeout','外部工具调用超时'
 elif re.search(r'(?:bad gateway|service unavailable|gateway timeout|network error|connection aborted)',msg):cat,zh='external_transport','外部工具网络或服务异常'
 else:cat,zh='external_tool_failure','外部工具执行失败'
 return (cat,zh,'L6.3' if source=='mcp' else 'L6.4','MCP Service' if source=='mcp' else 'Plugin Gateway Service','external_uncontrollable',f'工具来源为 {source}，按规则直接归外部原因，不进入 Agent 源码榜')

def scan(input_dir):
 rows=[];seen=set();scope=collections.Counter()
 for fp in sorted(Path(input_dir).glob('part_*.jsonl')):
  with fp.open(encoding='utf-8',errors='replace') as f:
   for line in f:
    x=json.loads(line);scope['traces']+=1;tid=str(x.get('id') or '');sid=str(x.get('sessionId') or tid);msgs=extract_messages(x.get('input'));calls={};latest_user=''
    for idx,m in enumerate(msgs):
     if str(m.get('role','')).lower()=='user' and str(m.get('content','')).strip():latest_user=norm(m.get('content'),1200)
     for tc in m.get('tool_calls') or []:
      if isinstance(tc,dict):
       fn=tc.get('function') or {};calls[str(tc.get('id') or '')]={'tool':str(fn.get('name') or ''),'args':str(fn.get('arguments') or ''),'idx':idx}
    for idx,m in enumerate(msgs):
     if str(m.get('role','')).lower()!='tool':continue
     content=str(m.get('content') or '');failed,reasons,flat=failure_envelope(content)
     if not failed:continue
     cid=str(m.get('tool_call_id') or '');call=calls.get(cid,{});tool=str(m.get('name') or call.get('tool') or '');source=tool_source(tool)
     event_id=cid or hashlib.sha1((tool+'|'+norm(content,1800)).encode()).hexdigest()[:20];key=(sid,event_id)
     if key in seen:continue
     seen.add(key)
     if source=='builtin':result=classify_builtin(tool,content,flat,call.get('args',''))
     else:result=classify_external(tool,content,flat,source)
     cat,zh,mid,mn,action,basis=result
     later=msgs[idx+1:];recovered=any(str(z.get('role','')).lower()=='tool' and not failure_envelope(str(z.get('content') or ''))[0] for z in later)
     rows.append({'trace_id':tid,'topic_id':sid,'timestamp':x.get('timestamp',''),'category':cat,'category_zh':zh,'module_id':mid,'module_name':mn,'badcase_kind':'recovered_with_capability_issue' if recovered else 'runtime_error','actionability':action,'needs_causal_review':action!='agent_orchestration_actionable','tool_source':source,'tool_name':tool,'tool_call_id':cid,'tool_arguments':norm(call.get('args',''),2400),'signal':'; '.join(reasons)+' | '+norm(pick(flat,'message','msg','reason','detail','error') or content,900),'context':norm(content,4200),'attribution_basis':basis,'error_exposure_node':f'{source} Tool Result: {tool}','abnormal_input_source':'Agent→Builtin 调用参数' if source=='builtin' else f'{source} 外部工具','user_task':latest_user,'recovered':recovered,'candidate_modules':[]})
    # Provider output: only explicit structured error envelope, never scan input/system/metadata.
    out=decode(x.get('output'));out_text=json.dumps(out,ensure_ascii=False,default=str) if not isinstance(out,str) else out
    err_type='';err_msg=''
    if isinstance(out,dict):err_type=str(out.get('errorType') or '');err_msg=str(out.get('error') or out.get('message') or '')
    if err_type or err_msg:
     combined=(err_type+' '+err_msg).lower()
     for cat,zh,mid,mn,pat in PROVIDER_CONTRACTS:
      if not re.search(pat,combined,re.I|re.S):continue
      key=(sid,'provider',cat,hashlib.sha1(combined.encode()).hexdigest()[:12])
      if key in seen:continue
      seen.add(key);rows.append({'trace_id':tid,'topic_id':sid,'timestamp':x.get('timestamp',''),'category':cat,'category_zh':zh,'module_id':mid,'module_name':mn,'badcase_kind':'runtime_error','actionability':'agent_orchestration_actionable','needs_causal_review':False,'tool_source':'provider_runtime','tool_name':'','tool_call_id':'','tool_arguments':'','signal':norm(err_type+' | '+err_msg,900),'context':norm(out_text,3000),'attribution_basis':'真实 Provider output Error Envelope 满足类别证据契约','error_exposure_node':'Provider output','abnormal_input_source':f'{mid} {mn}','user_task':latest_user,'recovered':False,'candidate_modules':[]})
  print(fp.name,'done',len(rows),flush=True)
 return rows,scope

def main():
 p=argparse.ArgumentParser();p.add_argument('--input-dir',required=True);p.add_argument('--output-dir',required=True);a=p.parse_args();out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True);rows,scope=scan(a.input_dir);d=pd.DataFrame(rows)
 d.to_csv(out/'classified_all.csv',index=False,encoding='utf-8-sig');internal=d[(d.actionability=='agent_orchestration_actionable')&(~d.needs_causal_review.astype(bool))].copy();external=d[~d.index.isin(internal.index)].copy();internal.to_csv(out/'classified_internal.csv',index=False,encoding='utf-8-sig');external.to_csv(out/'classified_external.csv',index=False,encoding='utf-8-sig');(out/'classified_all.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
 summary={'input_traces':scope['traces'],'failure_events':len(d),'failure_topics':d.topic_id.nunique() if len(d) else 0,'internal_events':len(internal),'internal_topics':internal.topic_id.nunique() if len(internal) else 0,'external_events':len(external),'external_topics':external.topic_id.nunique() if len(external) else 0,'tool_sources':d.tool_source.value_counts().to_dict() if len(d) else {},'internal_categories':internal.category.value_counts().to_dict() if len(internal) else {},'external_categories':external.category.value_counts().to_dict() if len(external) else {}}
 (out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()

"""Verbatim pure rules extracted from round1 maintained JSONL entry; no pandas/network.
Source: local_checks/2026-11-08_round1/attribution/structured_jsonl_attribution.py
SHA256: e90af4f86bbafdfdcab9a248b27a1854d4641036cbae63dda0ccdbdd597d9611
Legacy classifier results are candidates, never automatic root-cause responsibility.
"""
import json, re

SOURCE_SHA256 = 'e90af4f86bbafdfdcab9a248b27a1854d4641036cbae63dda0ccdbdd597d9611'
RULES_VERSION = "round1-structured-v1"

def decode(v):
 for _ in range(5):
  if not isinstance(v,str):break
  try:v=json.loads(v)
  except:break
 return v

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

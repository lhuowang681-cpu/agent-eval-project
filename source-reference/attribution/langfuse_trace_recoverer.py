from __future__ import annotations
from pathlib import Path
import html,json,re

ERROR_RE=re.compile(r'failed|error|invalid|timeout|not found|disabled|unavailable|exception|forbidden|unauthorized|exceeded|aborted',re.I)

def normalize(s):
 s=html.unescape(str(s or ''))
 for _ in range(4):
  s=s.replace('\\\\n','\n').replace('\\n','\n').replace('\\\\r','').replace('\\r','')
  s=s.replace('\\\\"','"').replace('\\"','"').replace('""','"')
 return s

def recover_events(trace):
 """Best-effort message recovery with stable synthetic IDs and call/result pairing hints."""
 n=normalize(' | '.join(trace.get('parts',[])));events=[]
 p=re.compile(r'"content"\s*:\s*"(.*?)"\s*(?:\||,)?\s*"role"\s*:\s*"(user|assistant|tool)"',re.I|re.S)
 for m in p.finditer(n):
  content=m.group(1);role=m.group(2).lower();tail=n[m.end():m.end()+1800]
  z=re.search(r'"name"\s*:\s*"([^"]+)"',tail);cid=re.search(r'"(?:tool_call_id|id)"\s*:\s*"([^"]+)"',tail)
  events.append({'pos':m.start(),'role':role,'content':content,'name':z.group(1) if z else '','arguments':'','call_id':cid.group(1) if cid else ''})
 fp=re.compile(r'"function"\s*:\s*\{.*?"arguments"\s*:\s*"(.*?)".*?"name"\s*:\s*"([^"]+)"',re.I|re.S)
 for m in fp.finditer(n):
  tail=n[m.end():m.end()+500];cid=re.search(r'"id"\s*:\s*"([^"]+)"',tail)
  events.append({'pos':m.start(),'role':'assistant','content':'','name':m.group(2),'arguments':m.group(1),'call_id':cid.group(1) if cid else ''})
 events.sort(key=lambda x:x['pos']);out=[];seen=set()
 for e in events:
  key=(e['role'],e['name'],e['content'][:500],e['arguments'][:500])
  if key in seen:continue
  seen.add(key);e['node_id']=f"recovered_{len(out)+1:04d}";e['parent_id']=out[-1]['node_id'] if out else '';e['is_error']=bool(ERROR_RE.search(e['content']))
  out.append(e)
 return out

def _tokens(signal):return [x for x in re.findall(r'[a-z_]{4,}|[\u4e00-\u9fff]{2,}',normalize(signal).lower()) if x not in {'error','failed'}]

def denoise_for_signal(events,signal,max_nodes=24):
 """Preserve causal context: user source, producing call, error result, recovery/final output."""
 signal=normalize(signal).lower();tokens=_tokens(signal);scores=[]
 for e in events:
  text=(e['content']+' '+e['name']+' '+e['arguments']).lower();score=(100 if signal and signal in text else 0)+sum(8 for x in tokens if x in text)
  if e['role']=='tool' and ERROR_RE.search(text):score+=20
  scores.append(score)
 focus=max(range(len(events)),key=lambda i:scores[i]) if events else 0;keep=set(range(max(0,focus-4),min(len(events),focus+6)))
 # Last user request establishes intent and parameter provenance.
 users=[i for i,e in enumerate(events[:focus+1]) if e['role']=='user']
 if users:keep.add(users[-1])
 # Keep up to two preceding calls: metadata/schema checks often reveal whether Agent ignored valid evidence.
 calls=[i for i,e in enumerate(events[:focus]) if e['role']=='assistant' and e['name']]
 keep.update(calls[-2:])
 # Keep prior tool result and post-error retry/final response.
 tool_results=[i for i,e in enumerate(events[:focus]) if e['role']=='tool'];keep.update(tool_results[-2:])
 after_calls=[i for i,e in enumerate(events[focus+1:],focus+1) if e['role']=='assistant' and e['name']];keep.update(after_calls[:2])
 finals=[i for i,e in enumerate(events[focus+1:],focus+1) if e['role']=='assistant' and e['content'].strip()]
 if finals:keep.add(finals[0]);keep.add(finals[-1])
 selected=[{**events[i],'retention_reason':('error_focus' if i==focus else 'causal_context')} for i in sorted(keep)]
 if len(selected)>max_nodes:selected=selected[:max_nodes]
 return selected,focus,max(scores) if scores else 0

def candidate_evidence(events):
 """Detect internal quality/performance candidates even when no tool node is marked error."""
 issues=[];last_user=next((e for e in reversed(events) if e['role']=='user'),None)
 calls=[e for e in events if e['role']=='assistant' and e['name']];results=[e for e in events if e['role']=='tool']
 counts={}
 for e in calls:counts[e['name']]=counts.get(e['name'],0)+1
 for name,n in counts.items():
  if n>=3:issues.append({'category':'repeated_tool_call','category_zh':'重复工具调用','module_id':'L2.2','module_name':'GeneralChatAgent','badcase_kind':'performance_badcase','evidence':f'{name} 在同一 Trace 调用 {n} 次'})
 failed=[e for e in results if ERROR_RE.search(e['content'])]
 if failed:
  pos=events.index(failed[-1]);later=events[pos+1:]
  later_calls=[e for e in later if e['role']=='assistant' and e.get('name')]
  later_success=[e for e in later if e['role']=='tool' and not ERROR_RE.search(e.get('content',''))]
  final_outputs=[e for e in later if e['role']=='assistant' and e.get('content','').strip()]
  if later_calls and (later_success or final_outputs):
   issues.append({'category':'recovered_tool_failure','category_zh':'工具失败后通过替代调用恢复','module_id':'L2.2','module_name':'GeneralChatAgent','badcase_kind':'recovered_with_capability_issue','evidence':f'失败后发生 {len(later_calls)} 次替代/重试调用，并出现成功结果或最终输出'})
 if last_user and re.search(r'查询|搜索|计算|文件|excel|sql|表|生成|下载|联网',last_user['content'],re.I) and not calls:
  issues.append({'category':'expected_tool_not_called','category_zh':'疑似应调用工具但未调用（待人工复核）','module_id':'L2.2','module_name':'GeneralChatAgent','badcase_kind':'quality_badcase','evidence':'用户任务具有工具型意图，但 Trace 未恢复出工具调用；也可能是导出恢复不完整','needs_review':True})
 return issues

def load_reconstructed(path,trace_ids=None):
 wanted={str(x) for x in trace_ids} if trace_ids else None;out={}
 with Path(path).open(encoding='utf-8') as f:
  for line in f:
   if wanted and not any(tid in line[:500] for tid in wanted):continue
   x=json.loads(line)
   if wanted is None or str(x.get('id')) in wanted:out[str(x.get('id'))]=x
   if wanted and len(out)==len(wanted):break
 return out

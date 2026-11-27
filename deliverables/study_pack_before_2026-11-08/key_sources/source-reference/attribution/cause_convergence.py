"""Deterministic severity × reach root-cause convergence and medoid selection.

LLM semantics are supported through the prompt constants below. In offline mode this
module uses evidence-derived signatures, deterministic severity anchors and TF-IDF
cosine medoid so all counts/scores/selections remain reproducible and auditable.
"""
from __future__ import annotations
import math,re,json
from collections import Counter,defaultdict
import numpy as np

ROOT_CAUSE_PROMPT = r'''你是 Agent 可靠性根因分析专家。下面给你【一个报错模块/类别】在过去一段时间内的报错样本，请归纳出导致该模块报错的【互斥的根本原因(root cause)】清单。

# 目标
把大量表面报错收敛成一组少而互斥的根因，供后续逐一评估严重度与频率。

# 硬性规则
1. 输出「根本原因」而非「表面症状」。例如同样报 "OIDC callback 失败"，底层根因可能是 token 过期 / redirect_uri 配置错误 / 时钟偏移 / 下游身份服务超时——要拆成不同 cause。
2. cause 之间尽量互斥(一条 trace 只归一个)、合起来尽量覆盖全部样本(MECE)；实在无法归类的少量样本归入 "other"。
3. 只依据样本中真实存在的证据归纳，不要脑补样本里没有的原因。
4. 为每个 cause 给出「判别信号」——凭 trace 里哪些字段/报错文本/错误码/调用栈特征就能判定一条 trace 属于它。这些信号后续要用来把每条 trace 分配到 cause，必须具体、可机械匹配。
5. 不要统计任何频率或数量——你只负责「有哪些根因」，出现多少次由系统另行统计。

# 输出
只输出 JSON 数组，不要解释、不要 markdown 围栏：
[{"cause_id":"c1","cause_name":"<简短根因名>","description":"<1-2句>","discriminating_signals":["<信号>"],"example_trace_ids":["<id>"]}]

# 输入
模块/类别名称：{{module_name}}
类别定义：{{category_definition}}
报错样本：{{error_samples}}'''

SEVERITY_PROMPT = r'''你是 Agent 可靠性分析专家。下面给你【一个报错模块/类别】下归纳出的全部「根本原因」，每个附若干示例 trace。请为每个原因判断它【单次发生】时对【最终用户使用体验】的严重度。

# 硬性规则
1. 只判严重度，绝对不要考虑任何原因出现的频率、数量或占比。
2. 以一次典型发生对终端用户的影响为准；不可逆尾部用 has_irreversible_tail=true 标记。
3. 只依据真实信息，信息不足降低 confidence。
4. 横向可比并拉开区分度。

# 子维度
user_visibility: direct|indirect|none
task_blocking: blocks|degrades|none
recoverability: unrecoverable|manual|auto
side_effect: irreversible|reversible|none

# 等级
S5/16 不可逆用户损害；S4/8 硬阻断且无法自动恢复；S3/4 降级或绕行；S2/2 轻微重试自愈；S1/1 纯内部自动处理。

# 输出
只输出 JSON 数组：
[{"cause_id":"c1","sub_scores":{"user_visibility":"...","task_blocking":"...","recoverability":"...","side_effect":"..."},"severity_level":"S1|S2|S3|S4|S5","severity_weight":1,"has_irreversible_tail":false,"confidence":0.8,"rationale":"<证据>"}]

# 输入
类别名称：{{category_name}}
类别定义：{{category_definition}}
候选原因：{{causes}}'''

DEFAULT_CONFIG={"confidence_threshold":0.6,"tie_tolerance":0.05,"frequency_method":"log2","beta":0.5}

def normalize_text(v):
 s=str(v or '').lower();s=re.sub(r'(?:tpc|msg|op|call)_[a-z0-9]+','<id>',s);s=re.sub(r'\b\d+\b','<n>',s);s=re.sub(r'\s+',' ',s).strip();return s[:900]
def signature(row):
 base=' | '.join(str(row.get(k,'') or '') for k in ['failed_tool','failure_output','original_error_type','error_message','reason','trace_summary'])
 s=normalize_text(base)
 # preserve high-value mechanics while removing per-request noise
 patterns=[
  (r'unexpected token.*not valid json|<html','endpoint_returned_non_json'),
  (r'timeout|timed out|query reached its timeout','tool_timeout'),
  (r'unsupported|validation|invalid (?:argument|type)|unable to extract','argument_or_type_validation'),
  (r'disabled|unavailable|not found|no such tool','tool_unavailable'),
  (r'no model specified|model.*required','model_parameter_missing'),
  (r'thinking.*invalid type|expected a boolean','thinking_type_mismatch'),
  (r'failed|error|exception','generic_execution_failure')]
 for p,name in patterns:
  if re.search(p,s,re.I):return name,s
 return (s[:100] or 'other'),s

def severity_for(row):
 """Deterministic offline severity anchors; never uses frequency."""
 impact=row.get('impact_status','');text=normalize_text(row.get('evidence_text') or row.get('reason'))
 irreversible=bool(re.search(r'资损|扣费|数据损坏|数据丢失|安全绕过|不可撤销|wrong charge|data loss|security bypass',text,re.I))
 if irreversible:return dict(severity_level='S5',severity_weight=16,has_irreversible_tail=True,confidence=.9,user_visibility='direct',task_blocking='blocks',recoverability='unrecoverable',side_effect='irreversible',rationale='证据包含不可逆资金、数据或安全后果')
 if impact=='hard_failed':return dict(severity_level='S4',severity_weight=8,has_irreversible_tail=False,confidence=.9,user_visibility='direct',task_blocking='blocks',recoverability='manual',side_effect='none',rationale='Trace 最终为硬失败，任务被用户直接感知地阻断')
 if impact in {'quality_badcase','performance_badcase'}:return dict(severity_level='S3',severity_weight=4,has_irreversible_tail=False,confidence=.75,user_visibility='indirect',task_blocking='degrades',recoverability='manual',side_effect='none',rationale='任务可完成但质量、时延或额外调用明显下降')
 if impact=='recovered_with_capability_issue':return dict(severity_level='S2',severity_weight=2,has_irreversible_tail=False,confidence=.85,user_visibility='indirect',task_blocking='degrades',recoverability='auto',side_effect='none',rationale='系统通过后续调用或替代路径恢复，但存在用户摩擦和额外开销')
 return dict(severity_level='S1',severity_weight=1,has_irreversible_tail=False,confidence=.6,user_visibility='none',task_blocking='none',recoverability='auto',side_effect='none',rationale='当前证据仅表明内部已处理问题')
def score(weight,n,method='log2',beta=.5):
 reach=math.log2(1+n) if method=='log2' else n**beta
 return round(weight*reach,2)
def tokenize(s):return re.findall(r'[a-z0-9_]+|[\u4e00-\u9fff]',normalize_text(s))
def medoid(rows,text_key='trace_summary'):
 if len(rows)==1:return rows[0],{rows[0]['trace_id']:0.0}
 docs=[tokenize(r.get(text_key,'')) for r in rows];df=Counter();[df.update(set(x)) for x in docs];N=len(docs);vocab=sorted(df);idx={w:i for i,w in enumerate(vocab)};X=np.zeros((N,len(vocab)))
 for i,toks in enumerate(docs):
  c=Counter(toks)
  for w,n in c.items():X[i,idx[w]]=(1+math.log(n))*math.log((1+N)/(1+df[w]))+1
 norm=np.linalg.norm(X,axis=1,keepdims=True);X=np.divide(X,norm,out=np.zeros_like(X),where=norm!=0);dist=1-X@X.T;avg=dist.mean(axis=1);k=int(np.argmin(avg));return rows[k],{r['trace_id']:round(float(avg[i]),6) for i,r in enumerate(rows)}
def converge(rows,session_of=lambda r:r.get('session_key'),config=None):
 cfg={**DEFAULT_CONFIG,**(config or {})};clusters=defaultdict(list)
 for r in rows:
  cid,sig=signature(r);r={**r,'cause_id':cid,'normalized_signature':sig};clusters[cid].append(r)
 scored=[]
 for cid,items in clusters.items():
  sev=max((severity_for(x) for x in items),key=lambda x:x['severity_weight']);sessions={session_of(x) or x['trace_id'] for x in items};n=len(sessions);sc=score(sev['severity_weight'],n,cfg['frequency_method'],cfg['beta']);scored.append({'cause_id':cid,'cause_name':cid,'discriminating_signals':[cid],'n_sessions':n,'score':sc,**sev,'trace_count':len({x['trace_id'] for x in items})})
 scored.sort(key=lambda x:(x['score'],x['severity_weight'],x['cause_id']),reverse=True)
 eligible=[x for x in scored if x['confidence']>=cfg['confidence_threshold']]
 winner=(eligible or scored)[0]
 if len(eligible)>1 and winner['score'] and (winner['score']-eligible[1]['score'])/winner['score']<cfg['tie_tolerance']:winner=max(eligible[:2],key=lambda x:x['severity_weight'])
 cluster=clusters[winner['cause_id']];rep,distances=medoid(cluster);return {'winner':winner,'representative':rep,'scored_causes':scored,'high_risk':[x for x in scored if x['has_irreversible_tail']],'needs_review':[x for x in scored if x['confidence']<cfg['confidence_threshold']],'medoid_distances':distances,'config':cfg}

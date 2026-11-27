"""Event -> failure pattern -> UNCONFIRMED hypotheses, not root clustering."""
from collections import Counter,defaultdict
import math,re
def token(s):return re.findall(r'[a-z0-9_]+|[\u4e00-\u9fff]',s.lower())
def medoid(events):
 docs=[Counter(token(e.get('text',''))) for e in events];df=Counter(k for d in docs for k in d);n=len(docs)
 vectors=[{k:(1+math.log(v))*math.log(1+n/(1+df[k])) for k,v in d.items()} for d in docs]
 def distance(a,b):
  den=math.sqrt(sum(v*v for v in a.values())*sum(v*v for v in b.values()))
  return 1-sum(v*b.get(k,0) for k,v in a.items())/den if den else 1
 return min(range(n),key=lambda i:(sum(distance(vectors[i],v) for v in vectors),events[i]['eventId']))
def analyze(events):
 seen={};raw=Counter();conflicts=[]
 for e in events:
  if not isinstance(e.get('severity'),int) or not 1<=e['severity']<=5:raise ValueError('invalid_severity')
  identity=tuple(e[k] for k in ['runId','caseId','threadId','toolCallId','eventId'])
  if identity in seen and seen[identity]!=e:conflicts.append(identity);continue
  raw[identity]+=1;seen.setdefault(identity,e)
 if conflicts:raise ValueError('conflicting_event_identity')
 groups=defaultdict(list)
 for identity,e in seen.items():
  # Unknown environment/context are not evidence of sameness: isolate unknowns.
  key=tuple(e.get(k) if e.get(k) is not None else 'unknown:'+str(identity) for k in ['signature','source','tool','operation','environment','errorContext'])
  groups[key].append((identity,e))
 out=[]
 for key,pairs in groups.items():
  rows=[e for _,e in pairs];tasks=defaultdict(list)
  for e in rows:tasks[(e['runId'],e['caseId'],e['threadId'])].append(e)
  states={}
  for task,items in tasks.items():
   states[task]={e.get('taskResult') for e in items}
  failed=sum(s=={'failed'} for s in states.values());unknown=sum(s not in ({'failed'},{'passed'}) for s in states.values())
  distribution=Counter(e['severity'] for e in rows);median=sorted(e['severity'] for e in rows)[(len(rows)-1)//2]
  typical=rows[medoid(rows)];debug=max(rows,key=lambda e:(e.get('evidenceQuality',0),e['severity'],e['eventId']));worst=max(rows,key=lambda e:(e['severity'],e['eventId']))
  recovered=sum(e.get('recovered') is True for e in rows)
  out.append({'pattern':dict(zip(['signature','source','tool','operation','environment','errorContext'],key)),'rootCause':None,'hypothesesStatus':'unconfirmed','rawEvents':sum(raw[i] for i,_ in pairs),'uniqueEvents':len(rows),'tasks':len(tasks),'recoveredEvents':recovered,'recoveryRate':recovered/len(rows),'failedTasks':failed,'unknownTaskOutcomes':unknown,'taskFailureRate':failed/(len(tasks)-unknown) if len(tasks)>unknown else None,'severityDistribution':dict(distribution),'maxSeverity':max(distribution),'typicalSeverity':median,'typicalTrace':typical['traceId'],'debugTrace':debug['traceId'],'worstTrace':worst['traceId'],'evidenceQualityDistribution':dict(Counter(e.get('evidenceQuality',0) for e in rows)),'priority':{'agentCode':'review_evidence_before_code_change','stability':'retry_fallback_replace_or_operate' if key[1] in ('mcp','plugin') else 'inspect_runtime'},'uncertainty':'Same pattern is not proof of shared mechanism; observed task failures are not causal attribution.'})
 return out

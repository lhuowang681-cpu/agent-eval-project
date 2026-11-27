"""Shadow-only v1 semantic comparison contract. No model/network/database writes."""
import copy,json
from .facts import allowed_values,result_index,key as event_key
CATEGORIES={'parameter_task_mismatch','answer_tool_mismatch','stale_information_use'}
FIELDS={'content','arguments','error'}
def text(v):return v if isinstance(v,str) else json.dumps(v,ensure_ascii=False,sort_keys=True,allow_nan=False)
def scalar(v):return v is None or type(v) in (str,int,bool) or type(v) is float and __import__('math').isfinite(v)
def equal(a,b):return type(a)==type(b) and a==b
def obj(s):
 try:
  v=json.loads(s);return v if isinstance(v,dict) else {}
 except (TypeError,ValueError):return {}
def review(trajectory,candidate):
 scope=copy.deepcopy(trajectory.get('scope',{}));digest=trajectory.get('inputDigest')
 result={'schemaVersion':1,'scope':scope,'inputDigest':digest,'decision':'abstain','reviews':[],'supportedObservations':[],'coverage':copy.deepcopy(trajectory.get('coverage'))}
 try:
  nodes=trajectory['nodes'];assert isinstance(nodes,list) and len(nodes)<=500
  assert all(isinstance(n,dict) and isinstance(n.get('id'),str) and n['id'] and isinstance(n.get('role'),str) and type(n.get('sequence')) is int for n in nodes)
  assert len({n['id'] for n in nodes})==len(nodes)
  assert len({n['sequence'] for n in nodes})==len(nodes)
  assert isinstance(scope,dict) and isinstance(digest,str) and digest and all(n.get('scope',scope)==scope for n in nodes)
  byid={n['id']:n for n in nodes}
  index=result_index(trajectory)
  assert isinstance(candidate,dict) and set(candidate)=={'schemaVersion','scope','inputDigest','decision','observations'}
  assert type(candidate['schemaVersion']) is int and candidate['schemaVersion']==1
  assert candidate['scope']==scope and candidate['inputDigest']==digest
  assert candidate['decision'] in ('candidates','abstain','unknown','needs_review')
  observations=candidate['observations'];assert isinstance(observations,list) and len(observations)<=8
  assert candidate['decision'] not in ('abstain','unknown') or not observations
  assert len({o['id'] for o in observations})==len(observations)
 except (KeyError,TypeError,AssertionError):
  result.update(decision='needs_review',error='invalid_contract_or_identity');return result
 for observation in observations:
  if not isinstance(observation,dict):
   result['reviews'].append({'id':None,'existence':'invalid','support':'insufficient','issues':['invalid_observation']});continue
  verdict={'id':observation.get('id'),'existence':'invalid','support':'insufficient','issues':[]}
  result['reviews'].append(verdict)
  try:
   assert set(observation)=={'id','category','claimLevel','summary','evidenceRefs','comparison'}
   assert isinstance(observation['id'],str) and observation['id']
   assert observation['category'] in CATEGORIES and observation['claimLevel'] in ('observation','impact_hypothesis','root_cause')
   assert isinstance(observation['summary'],str) and len(observation['summary'])<=1000
   comparison=observation['comparison'];assert set(comparison)=={'key','expected','actual'}
   key=comparison['key'];assert isinstance(key,str) and key.isidentifier() and scalar(comparison['expected']) and scalar(comparison['actual'])
   refs=observation['evidenceRefs'];assert isinstance(refs,list) and 1<=len(refs)<=12
   cited=[]
   for ref in refs:
    assert set(ref)=={'nodeId','field','quote'} and isinstance(ref['nodeId'],str) and ref['field'] in FIELDS
    node=byid[ref['nodeId']];quote=ref['quote']
    assert isinstance(quote,str) and quote and len(quote)<=2000 and quote in text(node[ref['field']])
    # Short excerpts may use the same field's envelope/context, never other fields.
    if key in quote or any(text(comparison[k]) in quote for k in ['expected','actual']):cited.append((node,ref['field']))
   verdict['existence']='valid'
   if observation['claimLevel']!='observation':raise ValueError('causal_or_impact_claim_unverified')
   def has(n,field):return any(x['id']==n['id'] and f==field for x,f in cited)
   def paired(n):
    calls=[c for c in nodes if c['role']=='call' and c.get('toolCallId')==n.get('toolCallId') and c.get('toolName')==n.get('toolName') and c.get('toolSource')==n.get('toolSource') and c['sequence']<n['sequence']]
    return len(calls)==1 and n.get('toolSource') in ('builtin','mcp','plugin')
   def data(n):
    return index.get(n['id'],{}).get('data',{})
   supported=False;category=observation['category']
   if category=='parameter_task_mismatch':
    for call in nodes:
     if call['role']!='call' or not has(call,'arguments') or call.get('toolSource') not in ('builtin','mcp','plugin'):continue
     if not call.get('toolCallId') or len([n for n in nodes if n['role']=='call' and event_key(n,scope)==event_key(call,scope)])!=1:continue
     users=[n for n in nodes if n['role']=='user' and n['sequence']<call['sequence']]
     if not users:continue
     user=max(users,key=lambda n:n['sequence']);allowed=allowed_values(user,key);actual=obj(call.get('arguments'))
     if has(user,'content') and allowed is not None and key in actual and any(equal(v,comparison['expected']) for v in allowed) and not any(equal(v,actual[key]) for v in allowed) and equal(actual[key],comparison['actual']):supported=True
    if not supported:raise ValueError('closed_task_constraint_violation_not_proven')
   else:
    answers=[n for n in nodes if n['role']=='assistant'];answer=max(answers,key=lambda n:n['sequence']) if answers else None
    final=obj(answer['content']) if answer else {}
    if answer and has(answer,'content') and key in final and equal(final[key],comparison['actual']):
     for n in nodes:
      if n['role']=='tool' and n['sequence']<answer['sequence'] and index[n['id']]['issue']:
       entity=obj(n['content']).get('data',{});entity=entity if isinstance(entity,dict) else {}
       if not entity.get('orderId') or entity.get('orderId')==final.get('orderId'):raise ValueError(index[n['id']]['issue'])
     tools=[n for n in nodes if n['sequence']<answer['sequence'] and data(n) and key in data(n) and 'orderId' in final and data(n).get('orderId')==final['orderId']]
     # Identical duplicate result events may be cited through either original ID.
     groups={}
     for n in tools:groups.setdefault(event_key(n,scope),[]).append(n)
     tools=[next((n for n in group if has(n,'content')),group[0]) for group in groups.values()]
     names={(n.get('toolName'),n.get('toolSource')) for n in tools}
     if tools and len(names)==1:
      latest=max(tools,key=lambda n:n['sequence']);latestdata=data(latest)
      if has(latest,'content') and equal(latestdata[key],comparison['expected']) and not equal(latestdata[key],final[key]):
       if category=='answer_tool_mismatch':supported=True
       else:supported=any(has(old,'content') and old['sequence']<latest['sequence'] and equal(data(old)[key],final[key]) for old in tools)
   if not supported:raise ValueError('comparison_not_proven_by_cited_local_facts')
   verdict['support']='supported'
   # Only this canonical bounded proposition is accepted; model prose is unverified.
   summary=f'Observed {category}: {key} expected {text(comparison["expected"])}; actual {text(comparison["actual"])}. Causal owner and task impact unconfirmed.'
   if category=='parameter_task_mismatch':summary=f'Observed parameter outside the explicitly closed allowed set for {key}; actual {text(comparison["actual"])}. Causal owner and task impact unconfirmed.'
   result['supportedObservations'].append({'id':observation['id'],'category':category,'claimLevel':'observation','comparison':copy.deepcopy(comparison),'evidenceRefs':copy.deepcopy(refs),'summary':summary})
  except (KeyError,TypeError,AssertionError):verdict['issues'].append('invalid_observation_or_reference')
  except ValueError as error:verdict['issues'].append(str(error))
 result['decision']='supported' if result['supportedObservations'] else 'needs_review' if observations else 'abstain'
 return result

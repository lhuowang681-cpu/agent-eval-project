"""Enhanced deterministic candidate generation. No Case IDs, labels or LLM."""
import copy,json
from .facts import obj,equal,scalar,allowed_values,result_index,key

def envelope(t,observations):
    return {'schemaVersion':1,'scope':copy.deepcopy(t['scope']),'inputDigest':t['inputDigest'],'decision':'candidates' if observations else 'abstain','observations':observations}

def generate(t):
    nodes=sorted(t['nodes'],key=lambda n:n['sequence']);observations=[]
    def add(category,field,expected,actual,refs):
        observations.append({'id':'rule'+str(len(observations)+1),'category':category,'claimLevel':'observation','summary':'Deterministic local comparison; impact and root unknown.','comparison':{'key':field,'expected':expected,'actual':actual},'evidenceRefs':[{'nodeId':n['id'],'field':f,'quote':n[f]} for n,f in refs]})
    if any(n.get('scope',t['scope'])!=t['scope'] for n in nodes):return envelope(t,[])
    for call in (n for n in nodes if n['role']=='call' and n.get('toolSource') in ('builtin','mcp','plugin')):
        users=[n for n in nodes if n['role']=='user' and n['sequence']<call['sequence']]
        if not users:continue
        user=users[-1];args=obj(call.get('arguments'))
        for field,value in args.items():
            allowed=allowed_values(user,field)
            if field.isidentifier() and scalar(value) and allowed is not None and not any(equal(value,v) for v in allowed):add('parameter_task_mismatch',field,allowed[0],value,[(user,'content'),(call,'arguments')])
    answers=[n for n in nodes if n['role']=='assistant']
    if not answers:return envelope(t,observations[:8])
    answer=answers[-1];final=obj(answer['content']);index=result_index(t)
    tools=[n for n in nodes if n['role']=='tool' and n['sequence']<answer['sequence'] and index[n['id']]['data'].get('orderId')==final.get('orderId') and final.get('orderId') is not None]
    # Suppress ambiguity for the same entity, including unknown-entity conflicts.
    for n in nodes:
        if n['role']=='tool' and n['sequence']<answer['sequence'] and index[n['id']]['issue']:
            data=obj(n['content']).get('data',{});data=data if isinstance(data,dict) else {}
            if not data.get('orderId') or data['orderId']==final.get('orderId'):return envelope(t,observations[:8])
    dedup={}
    for n in tools:dedup.setdefault(key(n,t['scope']),n)
    tools=list(dedup.values())
    if tools and len({(n['toolName'],n['toolSource']) for n in tools})==1:
        latest=max(tools,key=lambda n:n['sequence']);data=index[latest['id']]['data']
        for field,value in final.items():
            if field=='orderId' or not field.isidentifier() or not scalar(value) or field not in data or not scalar(data[field]) or equal(value,data[field]):continue
            add('answer_tool_mismatch',field,data[field],value,[(latest,'content'),(answer,'content')])
            older=[n for n in tools if n['sequence']<latest['sequence'] and equal(index[n['id']]['data'].get(field),value)]
            if older:add('stale_information_use',field,data[field],value,[(older[-1],'content'),(latest,'content'),(answer,'content')])
    return envelope(t,observations[:8])

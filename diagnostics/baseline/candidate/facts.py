"""Conservative shared provenance parsing, not a natural-language intent oracle."""
import json,math

def obj(value):
    try:
        result=json.loads(value)
        return result if isinstance(result,dict) else {}
    except (ValueError,TypeError):return {}

def equal(a,b):return type(a) is type(b) and a==b
def scalar(v):return v is None or type(v) in (str,int,bool) or type(v) is float and math.isfinite(v)

def allowed_values(user,key):
    """Only an explicit user-authored closed set is authoritative. Never infer it."""
    policy=obj(user.get('content')).get('parameterConstraints',{})
    rule=policy.get(key) if isinstance(policy,dict) else None
    if not isinstance(rule,dict) or set(rule)!={'allowed','closed'} or rule['closed'] is not True:return None
    values=rule['allowed']
    if not isinstance(values,list) or not 1<=len(values)<=32 or not all(scalar(v) for v in values):return None
    return values

def key(node,scope):
    return (json.dumps(node.get('scope',scope),sort_keys=True),node.get('toolCallId'),node.get('toolSource'),node.get('toolName'))

def result_index(trajectory):
    """Return each result's status. Identical duplicates are one logical result.

    Re-execution with a different toolCallId is a new attempt. Multiple Calls
    sharing an identity are ambiguous, even if arguments happen to match.
    """
    nodes=trajectory['nodes'];scope=trajectory['scope'];groups={};index={}
    for n in nodes:
        if n['role'] in ('call','tool'):groups.setdefault(key(n,scope),[]).append(n)
    for ident,events in groups.items():
        calls=[n for n in events if n['role']=='call'];results=[n for n in events if n['role']=='tool']
        issue=None
        if not isinstance(ident[1],str) or not ident[1] or ident[2] not in ('builtin','mcp','plugin') or not isinstance(ident[3],str) or not ident[3]:issue='invalid_call_identity'
        elif len(calls)!=1:issue='ambiguous_or_missing_call'
        elif any(n['sequence']<=calls[0]['sequence'] for n in results):issue='result_before_call'
        elif any(n.get('scope',scope)!=scope for n in events):issue='execution_scope_mismatch'
        signatures={json.dumps([obj(n['content']) or n['content'],n.get('error')],ensure_ascii=False,sort_keys=True) for n in results}
        if len(signatures)>1:issue='conflicting_results_for_call'
        for result in results:
            body=obj(result['content'])
            success=not issue and not result.get('error') and body.get('success') is True and isinstance(body.get('data'),dict)
            index[result['id']]={'issue':issue,'data':body['data'] if success else {},'identity':ident,'duplicates':len(results)-1}
    return index

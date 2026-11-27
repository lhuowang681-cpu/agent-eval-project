"""Label-blind, offline five-arm evaluation. Imports exactly one frozen/current engine."""
from pathlib import Path
import copy,json,sys,time

base=Path(__file__).resolve().parents[1]
engine=sys.argv[1]
assert engine in {'baseline','optimized'}
engine_dir=base/engine
sys.path.insert(0,str(engine_dir))
import adapter
from evidence_review import audited_candidate

FIELDS={'status','category','moduleId','claimLevel','summary','evidenceRefs','reasonCodes'}
MODULES={f'L{layer}.{leaf}' for layer,count in [(1,3),(2,5),(3,5),(4,7),(5,9),(6,8),(7,10),(8,9)] for leaf in range(1,count+1)}


def structure(candidate):
    problems=[]
    if not isinstance(candidate,dict):return ['not_object']
    if set(candidate)!=FIELDS:problems.append('candidate_fields')
    if candidate.get('status') not in ['resolved','unknown','needs_review','error']:problems.append('status')
    if not (candidate.get('category') is None or isinstance(candidate.get('category'),str) and candidate['category'] in adapter.CATEGORIES):problems.append('category')
    if not (candidate.get('moduleId') is None or isinstance(candidate.get('moduleId'),str) and candidate['moduleId'] in MODULES):problems.append('module')
    if candidate.get('claimLevel') not in ['observation','root_cause'] or not isinstance(candidate.get('summary'),str):problems.append('claim')
    reasons=candidate.get('reasonCodes')
    if not isinstance(reasons,list) or any(not isinstance(x,str) or not x for x in reasons):problems.append('reason_codes')
    refs=candidate.get('evidenceRefs')
    if not isinstance(refs,list) or len(refs)>500:return problems+['references']
    for ref in refs:
        if not isinstance(ref,dict) or set(ref)!={'nodeId','field','quote'} or not isinstance(ref.get('nodeId'),str) or not ref['nodeId'] or ref.get('field') not in ['content','error','arguments'] or not isinstance(ref.get('quote'),str) or not ref['quote']:
            problems.append('reference_shape')
    return sorted(set(problems))


def citations(trajectory,candidate):
    problems=structure(candidate)
    if problems:return problems
    if not candidate['evidenceRefs'] and (candidate['category'] is not None or candidate['moduleId'] is not None or candidate['claimLevel']=='root_cause'):
        problems.append('missing_evidence')
    nodes={node['id']:node for node in trajectory['nodes']}
    for ref in candidate['evidenceRefs']:
        node=nodes.get(ref['nodeId'])
        if node is None:problems.append('node_missing_in_scope')
        elif ref['quote'] not in adapter.serialize(node[ref['field']]):problems.append('quote_absent')
    return sorted(set(problems))


def evaluate(trajectory,candidate,method):
    if method=='rules':
        raw=adapter.analyze(trajectory)
        return {'output':raw['diagnosis'],'ruleObservations':raw['observations'],'issues':[]}
    if method=='direct':return {'output':copy.deepcopy(candidate),'issues':[]}
    problems=(structure(candidate) if method=='structured' else citations(trajectory,candidate)) if method in {'structured','citations'} else None
    if problems is not None:return {'output':None if problems else copy.deepcopy(candidate),'issues':problems}
    audited=audited_candidate(trajectory,candidate)
    return {'output':audited['safeCandidate'],'issues':[x['code'] for part in audited['review'].values() for x in part['issues']],'audit':audited}


def main():
    request=json.load(sys.stdin)
    # The worker must never receive evaluator labels or injected-root truth.
    assert set(request)=={'cases'}
    records=[]
    for row in request['cases']:
        assert set(row)=={'id','trajectory','candidate'}
        adapter.validate(row['trajectory'])
        before=copy.deepcopy(row)
        outcomes={}
        for method in ['rules','direct','structured','citations','full']:
            start=time.perf_counter_ns()
            try:
                result=evaluate(row['trajectory'],row['candidate'],method)
                result['executionError']=None
            except Exception as error:
                result={'output':None,'issues':[],'executionError':type(error).__name__}
            result['localSeconds']=(time.perf_counter_ns()-start)/1e9
            outcomes[method]=result
        assert before==row,'Input mutated'
        records.append({'id':row['id'],'outcomes':outcomes})
    print(json.dumps({'engine':engine,'engineDirectory':str(engine_dir),'records':records,'modelCalls':0,'tokenUsage':None,'modelLatencySeconds':None,'supplierCost':None,'candidateGeneration':'Fixed offline fixtures; no LLM inference.'},ensure_ascii=False,allow_nan=False))


if __name__=='__main__':main()

"""Independent stdlib-only structural/oracle consistency check; never a reviewer.
Does not classify error prose or derive correctness/support labels.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

HOME=Path(__file__).resolve().parent
CATEGORIES=set('context_window_exceeded provider_payload_invalid thinking_type_invalid model_missing builtin_tool_contract_invalid builtin_tool_unavailable builtin_result_parse_failed builtin_tool_failure_unclassified external_permission external_credential external_quota external_timeout external_transport external_tool_failure'.split())
MODULES={f'L{layer}.{index}' for layer,count in enumerate([3,5,5,7,9,8,10,9],1) for index in range(1,count+1)}

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)

def require(condition, message):
    if not condition:raise ValueError(message)

def exact(value, keys, label):
    require(isinstance(value,dict) and set(value)==set(keys.split()),label+' keys')

def nonempty(value):return isinstance(value,str) and bool(value.strip())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def load(path):
    lines=path.read_text(encoding='utf-8').splitlines()
    require(all(lines),'blank JSONL record')
    return [json.loads(line) for line in lines]

def validate_data(cases, inputs):
    require(24<=len(cases)<=30,'case count outside requested range')
    require(len(cases)==len(inputs),'projection count mismatch')
    require(len({case['id'] for case in cases})==len(cases),'duplicate case ID')
    seen_scopes=set()
    for case,public in zip(cases,inputs):
        exact(case,'id origin trajectory candidate labels','case')
        exact(public,'id origin trajectory candidate','public case')
        require(public=={k:v for k,v in case.items() if k!='labels'},'public projection mismatch')
        require(case['origin']=='synthetic' and re.fullmatch(r'ho-\d{3}',case['id']),'invalid origin/id')
        t=case['trajectory'];c=case['candidate'];l=case['labels']
        exact(t,'schemaVersion trajectoryId inputDigest scope nodes coverage evaluation','trajectory')
        require(t['schemaVersion']==1,'trajectory version')
        exact(t['scope'],'runId caseId topicId threadId operationId traceIds','scope')
        scope=t['scope'];identity=(scope['runId'],scope['caseId'],scope['topicId'],scope['threadId'])
        require(identity not in seen_scopes,'scope reuse');seen_scopes.add(identity)
        require(all(nonempty(scope[k]) for k in ['runId','caseId','topicId']),'missing scope ID')
        require(all(scope[k] is None or nonempty(scope[k]) for k in ['threadId','operationId']),'invalid optional scope ID')
        require(isinstance(scope['traceIds'],list) and all(map(nonempty,scope['traceIds'])),'trace IDs')
        require(t['trajectoryId']==f"eval:{scope['runId']}:{scope['caseId']}:{scope['topicId']}:{scope['threadId'] or 'main'}",'trajectory identity')
        content={k:v for k,v in t.items() if k!='inputDigest'}
        require(t['inputDigest']==hashlib.sha256(canonical(content).encode()).hexdigest(),'input digest mismatch')
        exact(t['coverage'],'source complete warnings','coverage')
        require(t['coverage']['source']=='database_messages' and type(t['coverage']['complete']) is bool,'coverage type')
        require(isinstance(t['coverage']['warnings'],list) and all(isinstance(x,str) for x in t['coverage']['warnings']),'coverage warnings')
        require(t['coverage']['complete'] or bool(t['coverage']['warnings']),'partial trace must explain coverage')
        exact(t['evaluation'],'status score task expected actual criteria','evaluation')
        e=t['evaluation'];require(isinstance(e['status'],str) and nonempty(e['task']),'evaluation text')
        require(e['score'] is None or (type(e['score']) in [int,float] and 0<=e['score']<=1),'evaluation score')
        require(all(e[k] is None or isinstance(e[k],str) for k in ['expected','actual','criteria']),'optional evaluation text')
        require(isinstance(t['nodes'],list) and 0<len(t['nodes'])<=500,'node count')
        ids={n['id'] for n in t['nodes']};require(len(ids)==len(t['nodes']),'duplicate node')
        for index,n in enumerate(t['nodes']):
            exact(n,'id messageId parentId role content sourcePointer errorSourcePointer toolCallId toolSource toolName arguments error traceId sequence createdAt','node')
            require(n['id'].startswith(case['id']+':') and nonempty(n['sourcePointer']),'node ownership/pointer')
            require(n['role'] in ['system','user','assistant','tool','call','error'],'node role')
            require(n['toolSource'] in ['builtin','mcp','plugin','unknown'],'tool source')
            require(n['sequence']==index and isinstance(n['content'],str),'sequence/content')
            require(n['parentId'] is None or n['parentId'] in ids or not t['coverage']['complete'],'dangling parent on complete trace')
            require(n['traceId'] is None or n['traceId'] in scope['traceIds'],'node trace outside scope')
            require(all(n[k] is None or isinstance(n[k],str) for k in ['messageId','toolCallId','toolName','arguments','createdAt','errorSourcePointer']),'optional node text')
            if n['role']=='tool' and n['toolCallId'] and t['coverage']['complete']:
                require(any(p['role']=='call' and p['toolCallId']==n['toolCallId'] for p in t['nodes']),'unpaired tool in complete trace')
        exact(c,'status category moduleId claimLevel summary evidenceRefs reasonCodes','diagnosis candidate')
        require(c['status'] in ['resolved','unknown','needs_review','error'],'candidate status')
        require(c['category'] is None or c['category'] in CATEGORIES,'candidate category enum')
        require(c['moduleId'] is None or c['moduleId'] in MODULES,'candidate module enum')
        require(c['claimLevel'] in ['observation','root_cause'] and isinstance(c['summary'],str),'candidate claim')
        require(isinstance(c['reasonCodes'],list) and all(map(nonempty,c['reasonCodes'])),'reasonCodes')
        require(isinstance(c['evidenceRefs'],list),'evidence list')
        for reference in c['evidenceRefs']:
            exact(reference,'nodeId field quote','evidence')
            require(nonempty(reference['nodeId']) and nonempty(reference['quote']) and reference['field'] in ['content','error','arguments'],'evidence syntax')
            # Deliberately bad references are legitimate reviewer inputs. Do not
            # repair them, remove them, or relabel semantic truth automatically.
        exact(l,'observationCategories observationEligible root candidateCorrect candidateSupported labelRationale safeCanonicalSupported ruleCanonicalSupported','labels')
        require(isinstance(l['observationCategories'],list) and len(l['observationCategories'])==len(set(l['observationCategories'])) and set(l['observationCategories'])<=CATEGORIES,'observation labels')
        require(type(l['observationEligible']) is bool and l['observationEligible']==bool(l['observationCategories']),'eligibility label consistency')
        require(l['candidateCorrect'] is None or type(l['candidateCorrect']) is bool,'candidateCorrect label type')
        require(all(type(l[k]) is bool for k in ['candidateSupported','safeCanonicalSupported','ruleCanonicalSupported']),'support label types')
        require(nonempty(l['labelRationale']),'label rationale')
        exact(l['root'],'known moduleId category rationale','root labels')
        r=l['root'];require(type(r['known']) is bool and nonempty(r['rationale']),'root metadata')
        require(r['moduleId'] is None or r['moduleId'] in MODULES,'root module')
        require(r['category'] is None or r['category'] in CATEGORIES,'root category')
        require(r['known'] or (r['moduleId'] is None and r['category'] is None),'unknown root cannot have a target')
        require(not r['known'] or r['category'] is not None,'known root needs category')
        if c['status']=='unknown' and c['category'] is None and not c['evidenceRefs']:
            require(l['candidateCorrect'] is None,'abstention must not count as a correct positive root')
        if l['candidateCorrect'] is True and c['claimLevel']=='root_cause':
            require(r['known'] and c['moduleId']==r['moduleId'] and c['category']==r['category'],'true root candidate target mismatch')
        if l['candidateCorrect'] is True and c['claimLevel']=='observation':
            require(c['category'] in l['observationCategories'],'true observation category mismatch')
        if l['safeCanonicalSupported']:
            require(c['category'] is not None and bool(c['evidenceRefs']),'canonical support without a positive cited category')
        require(l['ruleCanonicalSupported']==l['observationEligible'],'canonical full-trace support differs from authored eligibility')
        # Check isolation rather than infer labels from their textual keywords.
        trajectory_wire=canonical(t)
        require(not re.search(r'L[1-8]\.\d+',trajectory_wire),'module target literal leaked into trajectory')
        require(not any(token in trajectory_wire for token in ['candidateCorrect','candidateSupported','safeCanonicalSupported','ruleCanonicalSupported','observationEligible','ground_truth','root_known']),'oracle field leaked into trajectory')
        require(l['labelRationale'] not in canonical(public) and r['rationale'] not in canonical(public),'private rationale leaked')
    return len(cases)

def validate_manifest():
    path=HOME/'split-manifest.json'
    require(path.exists(),'freeze manifest missing')
    manifest=json.loads(path.read_text(encoding='utf-8'))
    require(manifest['split']=='holdout' and manifest['usedForOptimization'] is False,'not an isolated holdout')
    for name,expected in manifest['files'].items():
        resolved=(HOME/name).resolve()
        require(resolved.is_relative_to(HOME.resolve()),'manifest escapes holdout')
        require(sha(resolved)==expected,'frozen file hash mismatch: '+name)
    expected=(HOME/'MANIFEST.sha256').read_text(encoding='utf-8').split()[0]
    require(sha(path)==expected,'manifest commitment mismatch')
    return manifest

def main():
    cases=load(HOME/'private'/'cases.jsonl');inputs=load(HOME/'inputs.jsonl')
    count=validate_data(cases,inputs)
    if '--unfrozen' not in sys.argv:
        manifest=validate_manifest();require(manifest['caseCount']==count,'manifest count')
    print(json.dumps({'status':'passed','cases':count,'checks':['strict_structure','identity_and_digest','label_type_consistency','unlabeled_projection','no_structural_label_leakage','frozen_hashes' if '--unfrozen' not in sys.argv else 'pre_freeze'],'semanticOracle':'single_author_synthetic_not_real_annotation','productionReviewerRun':False},ensure_ascii=False))

if __name__=='__main__':main()

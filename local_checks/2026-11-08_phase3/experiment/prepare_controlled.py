"""Replay four saved real executions of synthetic local tasks, not natural gold data."""
from pathlib import Path
import hashlib,json
base=Path(__file__).resolve().parents[1]
source=base.parent/'2026-11-08_phase2/increment2/http/results.json'
data=json.loads(source.read_text(encoding='utf-8'))
cases=[]
for event in data['events']:
 if event['stage']!='diagnostic-result':continue
 trajectory=event['trace'];diagnosis=event['job']['result']['diagnosis']
 # This label concerns one literal recorded CalculationError in a controlled
 # experiment. It is not an independent label of the originating internal owner.
 tools=[n for n in trajectory['nodes'] if n['role']=='tool' and n['toolSource']=='builtin' and isinstance(n['error'],dict) and n['error'].get('type')=='CalculationError']
 observed=bool(tools)
 labels={'observationCategories':['builtin_tool_failure_unclassified'] if observed else [],'observationEligible':observed,
  'root':{'known':False,'category':None,'moduleId':None,'rationale':'Saved DB fields do not establish the earliest responsible internal module.'},
  'candidateCorrect':True if observed else None,'candidateSupported':observed,'safeCanonicalSupported':observed,'ruleCanonicalSupported':observed,
  'labelRationale':'Single literal structured CalculationError with original error/call references; bounded observation only.' if observed else 'Quality score failed but no runtime failure signal recorded; no answerable failure category.'}
 cases.append({'id':'controlled-'+str(len(cases)+1),'origin':'real_execution_synthetic_task','trajectory':trajectory,'candidate':diagnosis,'labels':labels})
assert len(cases)==4 and sum(x['labels']['observationEligible'] for x in cases)==1
target=base/'data/controlled-replay.jsonl'
target.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in cases),encoding='utf-8')
(base/'data/controlled-manifest.json').write_text(json.dumps({'cases':4,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'source':str(source),'provenance':'Saved real PostgreSQL/local Agent execution with Mock-generated tasks; not natural production or independently root-labelled data.','freshHttpOrDbRunThisRound':False},indent=2),encoding='utf-8')
print(json.dumps({'realControlledReplayCases':4,'literalFailureObservations':1}))

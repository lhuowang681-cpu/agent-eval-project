"""Apply enhanced rules to exactly the six historical model inputs; no calls."""
import json
from pathlib import Path
from candidate.baseline import generate
from candidate.review import review
from candidate.facts import obj,equal
BASE=Path(__file__).resolve().parent
def sig(o):return json.dumps([o['category'],o['comparison']],sort_keys=True)
if __name__=='__main__':
 rows={r['id']:r for r in map(json.loads,(BASE/'previous/data/holdout.jsonl').read_text(encoding='utf-8').splitlines())}
 real=json.loads((BASE/'previous/results/real-holdout.json').read_text(encoding='utf-8'))
 records=[]
 for r in real['records']:
  t=rows[r['id']]['trajectory'];b=generate(t);br=review(t,b);dr=review(t,r['candidate'])
  # A neutral field inequality witness is not a verified task violation.
  comparisons=[];nodes={n['id']:n for n in t['nodes']}
  for o in r['direct']:
   field=o['comparison']['key'];values=[]
   for ref in o['evidenceRefs']:
    body=obj(nodes[ref['nodeId']][ref['field']]);body=body.get('data',body)
    if field in body:values.append(body[field])
   comparisons.append({'category':o['category'],'comparison':o['comparison'],'fieldDifferenceComputable':any(not equal(a,b) for a in values for b in values),'notAClaimOfBusinessViolation':o['category']=='parameter_task_mismatch'})
  rb={sig(o) for o in br['supportedObservations']};rd={sig(o) for o in dr['supportedObservations']}
  records.append({'id':r['id'],'historicalRawModelOutput':r['candidate'],'historicalTransport':r['transport'],'baseline':b,'baselineReview':br,'modelCandidateNewReview':dr,'newSupportedLLMOnly':sorted(rd-rb),'neutralFieldComparisons':comparisons})
 result={'mode':'HISTORICAL_REAL_RESPONSES_OFFLINE_REUSE','historicalRealCalls':6,'newRealCalls':0,'records':records,'baselineClaims':sum(len(r['baseline']['observations']) for r in records),'baselineSupported':sum(len(r['baselineReview']['supportedObservations']) for r in records),'historicalModelClaims':sum(len(r['historicalRawModelOutput']['observations']) for r in records),'historicalModelSupportedUnderNewReview':sum(len(r['modelCandidateNewReview']['supportedObservations']) for r in records),'newSupportedLLMOnly':sum(len(r['newSupportedLLMOnly']) for r in records),'computableFieldComparisons':sum(c['fieldDifferenceComputable'] for r in records for c in r['neutralFieldComparisons']),'limitation':'Old simple synthetic inputs were already observed; not an independent test. A missing closed constraint is now unverified, not a proven business violation.'}
 (BASE/'results/legacy-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({k:v for k,v in result.items() if k!='records'}))

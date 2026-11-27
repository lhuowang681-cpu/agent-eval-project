"""Re-score saved outputs with a separate output-level review; never rerun engines."""
from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json
from metrics import summarize
base=Path(__file__).resolve().parents[1]
adjudication=base/'adjudication'
decisions=json.loads((adjudication/'DECISIONS.json').read_text(encoding='utf-8'))
assert decisions['inputSha256']==hashlib.sha256((adjudication/'INPUT.json').read_bytes()).hexdigest()
verdicts={x['id']:x for x in decisions['decisions']}
assert len(verdicts)==len(decisions['decisions'])==30
mapping=json.loads((adjudication/'MAP.json').read_text(encoding='utf-8'))
datasets={'development':base/'data/development.jsonl','controlled':base/'data/controlled-replay.jsonl','holdout':base/'holdout/private/cases.jsonl'}
for split,path in datasets.items():
 original=[json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x]
 results={}
 for engine in ['baseline','optimized']:
  cases=copy.deepcopy(original);by_id={x['id']:x for x in cases}
  for row in cases:
   row['labels']['ruleCanonicalSupported']=None
  raw=json.loads((base/'results'/split/(engine+'-outputs.json')).read_text(encoding='utf-8'))
  outputs={x['id']:x for x in raw['records']}
  for item in mapping:
   if item['split']!=split or item['engine']!=engine:continue
   out=outputs[item['caseId']]['outcomes'][item['method']]['output']
   proposition={k:out[k] for k in ['category','moduleId','claimLevel','summary','evidenceRefs']}
   digest=hashlib.sha256(json.dumps(proposition,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
   assert digest==item['outputSha256']
   verdict=verdicts[item['id']]
   assert verdict['correct'] is None or type(verdict['correct']) is bool
   assert verdict['supported'] is None or type(verdict['supported']) is bool
   prefix='ruleCanonical' if item['method']=='rules' else 'safeCanonical'
   by_id[item['caseId']]['labels'][prefix+'Supported']=verdict['supported']
   by_id[item['caseId']]['labels'][prefix+'Correct']=verdict['correct']
  results[engine]=summarize(cases,raw)
 report={'dataset':str(path),'datasetSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'generatedAtUtc':datetime.now(timezone.utc).isoformat(),'sourceOutputsUnchanged':True,'engineRerun':False,'retuning':False,'outputAdjudicationSha256':hashlib.sha256((adjudication/'DECISIONS.json').read_bytes()).hexdigest(),'adjudicator':decisions['reviewer'],'limitations':decisions['limitations'],'cases':len(original),'engines':results}
 (base/'results'/split/'comparison-adjudicated.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'split':split,'methods':{k:{field:v[field] for field in ['claims','correctClaims','wrongClaims','unjudgedClaims','effectiveObservationCases','correctKnownRoots','knownRootCases']} for k,v in results['optimized']['metrics'].items()}}))

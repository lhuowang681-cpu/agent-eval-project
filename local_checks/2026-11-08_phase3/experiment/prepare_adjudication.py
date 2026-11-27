"""Hide method/gate verdicts; request separate support labels for actual canonical outputs."""
from pathlib import Path
import hashlib,json
from metrics import claim
base=Path(__file__).resolve().parents[1]
datasets={'development':base/'data/development.jsonl','controlled':base/'data/controlled-replay.jsonl','holdout':base/'holdout/private/cases.jsonl'}
records=[];mapping=[];seen={}
for split,path in datasets.items():
 cases={row['id']:row for row in [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x]}
 for engine in ['baseline','optimized']:
  outputs=json.loads((base/'results'/split/(engine+'-outputs.json')).read_text(encoding='utf-8'))
  for record in outputs['records']:
   for method in ['rules','full']:
    output=record['outcomes'][method]['output']
    if not claim(output):continue
    proposition={k:output[k] for k in ['category','moduleId','claimLevel','summary','evidenceRefs']}
    digest=hashlib.sha256(json.dumps(proposition,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    key=(split,record['id'],digest)
    if key not in seen:
     identifier='claim-'+str(len(records)+1).zfill(3);seen[key]=identifier
     row=cases[record['id']]
     records.append({'id':identifier,'trajectory':row['trajectory'],'output':proposition,'observationOracle':{'eligible':row['labels']['observationEligible'],'categories':row['labels']['observationCategories']},'outputSha256':digest})
    mapping.append({'id':seen[key],'split':split,'caseId':record['id'],'engine':engine,'method':method,'outputSha256':digest})
dest=base/'adjudication';dest.mkdir(exist_ok=True)
(dest/'INPUT.json').write_text(json.dumps({'instruction':'Independently assess whether the actual cited original fields support only this bounded output proposition. Do not infer responsible module or use the gate verdict. The observation oracle is synthetic, single-author; report ambiguity as null.','records':records},ensure_ascii=False,indent=2),encoding='utf-8')
(dest/'MAP.json').write_text(json.dumps(mapping,indent=2),encoding='utf-8')
print(json.dumps({'uniqueCanonicalClaims':len(records),'methodMappings':len(mapping)}))

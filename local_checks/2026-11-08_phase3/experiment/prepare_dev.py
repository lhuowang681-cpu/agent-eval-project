"""Re-annotate disclosed Phase2 diagnostic cases; never call them an independent set."""
from pathlib import Path
import hashlib,json
base=Path(__file__).resolve().parents[1]
source=base.parent/'2026-11-08_phase2/increment3/experiment/input.json'
old=json.loads(source.read_text(encoding='utf-8'))
# Whole-claim truth and evidence support are separate, rather than treating every
# invalid citation or unknown responsible module as a factually false conclusion.
annotations={
 'normal_unknown':(None,False,'No claim; abstention is not a correct root classification.'),
 'external500_wrong_L2_2':(None,False,'500 is observed; originating internal module is not independently known.'),
 'valid_quote_no_causal_chain':(None,False,'Real quote does not identify the responsible internal module.'),
 'fabricated_node':(True,False,'Failure is present, but the candidate cites a fabricated node.'),
 'cross_case_node':(True,False,'Failure is present, but the candidate cites another case.'),
 'no_failure_signal':(False,False,'Synthetic execution is normal; asserted failure is contradicted.'),
 'unknown_source':(None,False,'A failure exists, but external source cannot be established from the presented trace.'),
 'missing_parent':(True,True,'Missing upstream parent does not erase this genuine tool error observation.'),
 'invalid_category_module':(False,False,'Category/module are outside the declared classification dictionary.'),
 'extra_causal_summary':(None,False,'Internal argument mutation is not independently adjudicated; the causal addition is unsupported.'),
 'valid_observation_template':(True,True,'Bounded external failure; no originating owner asserted.'),
 'supported_paraphrase':(True,True,'Factual paraphrase observes external 500 and explicitly leaves owner unknown.'),
}
cases=[]
for row in old['fixtures']:
 correct,supported,rationale=annotations[row['id']]
 category=row['labels']['expectedObservationCategory']
 cases.append({'id':'dev-'+row['id'],'origin':'synthetic','trajectory':row['trajectory'],'candidate':row['candidate'],
  'labels':{'observationCategories':[category] if category else [],'observationEligible':category is not None,
   'root':{'known':False,'moduleId':None,'category':None,'rationale':'Phase2 fixtures did not independently establish an originating module.'},
   'candidateCorrect':correct,'candidateSupported':supported,'safeCanonicalSupported':supported,'ruleCanonicalSupported':category is not None,'labelRationale':rationale}})
dest=base/'data';dest.mkdir(exist_ok=True)
target=dest/'development.jsonl';target.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in cases),encoding='utf-8')
(dest/'development-manifest.json').write_text(json.dumps({'split':'development_only','cases':len(cases),'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'labels':'Single-author manual reannotation; public/disclosed development fixtures, not gold real labels.','rootAccuracyMeasurable':False,'candidateGeneration':'Preserved Phase2 controlled candidate; prior localhost SDK echo receipt is separate, not inference.'},indent=2),encoding='utf-8')
print(json.dumps({'developmentCases':len(cases)}))

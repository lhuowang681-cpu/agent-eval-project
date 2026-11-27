"""Frozen fixture replay or bounded real calls. Gold never enters the prompt."""
from pathlib import Path
import copy,getpass,hashlib,json,sys,time,os
BASE=Path(__file__).resolve().parent
APP=BASE.parent/'2026-11-08_platform_audit/platform'
RULES_DIR=APP/'scripts/eval-attribution' if APP.exists() else BASE/'baseline'
sys.path[:0]=[str(BASE/'shadow'),str(RULES_DIR)]
from semantic_review import review
from client import generate
import adapter

def stats(records,rows):
 byid={r['id']:r for r in rows};out={};raw_eligible={}
 for method in ['rules','direct','reviewed']:
  claims=correct=wrong=unknown=supported=fp=gap=refs=valid=abstain=detected=rootclaims=0;types={};casecoverage=0
  for record in records:
   row=byid[record['id']];expected=set(row['labels']['expectedCategories']);prediction=record[method]
   found=set();good=set();accepted_signatures=set();nodes={n['id']:n for n in row['trajectory']['nodes']}
   if not prediction:abstain+=1
   for obs in prediction:
    claims+=1
    if not isinstance(obs,dict) or not isinstance(obs.get('category'),str):
     unknown+=1;continue
    category=obs['category'];found.add(category)
    # Real candidates are judged against the declared synthetic field relations,
    # not their self-rated confidence or the reviewer's own verdict.
    cmp=obs.get('comparison',{})
    if category not in {'parameter_task_mismatch','answer_tool_mismatch','stale_information_use'}:
     truth=row['labels']['explicitFailure'];adequate=truth
    else:
     gold={'key':'year','expected':2025,'actual':2024} if category=='parameter_task_mismatch' else {'key':'status','expected':'pending','actual':'shipped'}
     truth=category in expected and cmp==gold and obs.get('claimLevel')=='observation'
     adequate=truth
     # Scope/provenance and real citations still checked independently below.
    observation_valid=True;cited=set()
    observation_refs=obs.get('evidenceRefs',[])
    if not isinstance(observation_refs,list):observation_refs=[];observation_valid=False
    for ref in observation_refs:
     refs+=1
     if not isinstance(ref,dict):observation_valid=False;continue
     n=nodes.get(ref.get('nodeId')) if isinstance(ref.get('nodeId'),str) else None
     field=ref.get('field');quote=ref.get('quote')
     text=n.get(field) if n and field in ['content','arguments','error'] else None
     if not isinstance(text,str):text=json.dumps(text,ensure_ascii=False,sort_keys=True)
     goodref=bool(n and isinstance(quote,str) and quote and quote in text);valid+=goodref;observation_valid &= goodref
     if goodref:cited.add((ref['nodeId'],field))
    if category in {'parameter_task_mismatch','answer_tool_mismatch','stale_information_use'}:
     ident=row['id'];latest='r2' if row['kind']=='C' else 'r'
     required={(ident+'-u','content'),(ident+'-c','arguments')} if category=='parameter_task_mismatch' else {(ident+'-'+latest,'content'),(ident+'-a','content')}
     if category=='stale_information_use':required.add((ident+'-r','content'))
     identity=record.get('candidate') or {};adequate=adequate and observation_valid and required<=cited and identity.get('scope')==row['trajectory']['scope'] and identity.get('inputDigest')==row['trajectory']['inputDigest']
    if obs.get('claimLevel') in ('root_cause','impact_hypothesis') or row['kind']=='missing':
     unknown+=1;rootclaims+=int(obs.get('claimLevel')=='root_cause')
    elif truth:correct+=1
    else:wrong+=1
    if truth and adequate:good.add(category)
    if method=='reviewed' and not adequate:fp+=1
    if adequate:supported+=1
    signature=json.dumps([category,cmp],sort_keys=True)
    if method=='direct' and adequate:raw_eligible.setdefault(row['id'],set()).add(signature)
    if method=='reviewed' and adequate:accepted_signatures.add(signature)
   if good & expected:casecoverage+=1
   detected+=len(good & expected)
   if method=='reviewed':
    # False Gap counts independently adequate raw candidates lost in review.
    # Real outputs are also retained for manual case-level review.
    gap+=len(raw_eligible.get(row['id'],set())-accepted_signatures)
   bucket=types.setdefault(row['kind'],{'cases':0,'claims':0,'correctCategories':0});bucket['cases']+=1;bucket['claims']+=len(prediction);bucket['correctCategories']+=len(good & expected)
  positives=sum(bool(r['labels']['expectedCategories']) for r in rows);targets=sum(len(set(r['labels']['expectedCategories'])) for r in rows)
  out[method]={'cases':len(rows),'claims':claims,'correctObservations':correct,'wrongObservations':wrong,'unknownClaims':unknown,'rootClaims':rootclaims,'verifiedRootClaims':0,'rootAccuracy':None,'falseSupport':fp if method=='reviewed' else None,'falseGap':gap if method=='reviewed' else None,'validReferences':valid,'references':refs,'referenceValidity':valid/refs if refs else None,'semanticPositiveCases':positives,'coveredSemanticCases':casecoverage,'effectiveSemanticCaseCoverage':casecoverage/positives if positives else None,'semanticCategoriesDetected':detected,'semanticCategoryTargets':targets,'abstentions':abstain,'abstentionRate':abstain/len(rows),'byType':types}
 return out

def main():
 mode=sys.argv[1];split=sys.argv[2] if len(sys.argv)>2 else 'holdout'
 rows=[json.loads(x) for x in (BASE/'data'/(split+'.jsonl')).read_text(encoding='utf-8').splitlines()]
 real=mode=='real'
 if mode not in ['replay','real']:raise ValueError('Choose replay or real explicitly')
 if real:
  selected=['A','B','C','normal','recovered','multi'];rows=[next(r for r in rows if r['kind']==kind) for kind in selected]
  ledger=BASE/'results/real_attempts.json'
  if ledger.exists():raise RuntimeError('Real budget ledger already exists; no automatic repeat')
  ledger.write_text(json.dumps({'maximumRequests':6,'attempts':0}),encoding='utf-8')
  key=os.environ.get('DEEPSEEK_API_KEY') or getpass.getpass('DeepSeek key (not saved): ')
 records=[]
 for i,row in enumerate(rows):
  before=copy.deepcopy(row['trajectory']);baseline=adapter.analyze(row['trajectory'])
  if real:
   ledger.write_text(json.dumps({'maximumRequests':6,'attempts':i+1}),encoding='utf-8')
   candidate,usage=generate(row['trajectory'],row['origin'],key)
  else:candidate=copy.deepcopy(row['fixtureCandidate']);usage={'error':None,'usage':None,'realCalls':0,'fixtureReplay':True}
  reviewed=review(row['trajectory'],candidate) if candidate else {'decision':'needs_review','supportedObservations':[],'error':'generation_failed'}
  record={'id':row['id'],'kind':row['kind'],'candidate':candidate,'rules':baseline['observations'],'direct':candidate.get('observations',[]) if isinstance(candidate,dict) and isinstance(candidate.get('observations'),list) else [],'reviewed':reviewed['supportedObservations'],'review':reviewed,'transport':usage}
  records.append(record);assert before==row['trajectory']
  if real and usage['error']:
   # Stop on first supplier/config/parse failure, no fallback/retry spending.
   break
  result={'mode':'real_model_on_synthetic_data' if real else 'controlled_fixture_replay_NOT_LLM','records':records,'metrics':stats(records,rows[:len(records)]),'realCalls':len(records) if real else 0,'costStatus':'provider usage saved; monetary cost not returned, no bill verified','datasetSha256':hashlib.sha256((BASE/'data'/(split+'.jsonl')).read_bytes()).hexdigest()}
  (BASE/'results'/((mode+'-'+split)+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 # Preserve even the very first failed real attempt.
 result={'mode':'real_model_on_synthetic_data' if real else 'controlled_fixture_replay_NOT_LLM','records':records,'metrics':stats(records,rows[:len(records)]),'realCalls':len(records) if real else 0,'costStatus':'actual bill unknown','datasetSha256':hashlib.sha256((BASE/'data'/(split+'.jsonl')).read_bytes()).hexdigest()}
 (BASE/'results'/((mode+'-'+split)+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'mode':mode,'cases':len(records),'metrics':result['metrics'],'realCalls':result['realCalls']},ensure_ascii=True))
if __name__=='__main__':main()

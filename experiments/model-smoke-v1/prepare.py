"""Freeze current code; review Gold before any new model output or paid request."""
import copy,csv,datetime,hashlib,json,shutil,sys
from pathlib import Path
B=Path(__file__).resolve().parent;OLD=B.parent/'postgres-acceptance';APP=B.parents[1]/'platform'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if __name__=='__main__':
 if (B/'FREEZE.json').exists():raise SystemExit('Already frozen; never overwrite')
 for n in ['results','integration','gold','smoke']:(B/n).mkdir(exist_ok=True)
 source=json.loads((OLD/'FINAL_MANIFEST.json').read_text(encoding='utf-8'))
 assert all(sha(OLD/p)==h for p,h in source['files'].items())
 shutil.copytree(OLD,B/'previous',ignore=shutil.ignore_patterns('__pycache__'))
 files=[*list((APP/'src/server/services/agentEvalAttribution').glob('*.ts')),*list((APP/'scripts/eval-attribution').glob('*.py'))]
 original=[json.loads(s) for s in (OLD/'dataset/holdout.jsonl').read_text(encoding='utf-8').splitlines()];view=copy.deepcopy(original);byid={r['id']:r for r in view}
 prior=json.loads((OLD/'dataset/ADJUDICATION.json').read_text(encoding='utf-8'))
 for a in prior['addGold']:byid[a['id']]['gold'].append(a['observation'])
 for a in prior['excludeUnsupportedGold']:byid[a['id']]['gold']=[g for g in byid[a['id']]['gold'] if g['kind']!=a['kind']]
 reviews=[]
 hint_words=['错误','误读','矛盾','错误','仍用旧','答案','根因','调用明确不可用','失败引文']
 for row in view:
  kinds={g['kind'] for g in row['gold']};issues=[]
  if any(w in row['title'] for w in hint_words):issues.append('task_contains_diagnostic_or_answer_hint')
  if row['scenario']=='changed':issues.append('change_in_one_text_not_true_multi_turn')
  if row['scenario'] in ('short','root'):issues.append('gold_observation_does_not_itself_test_adversarial_candidate')
  if row['scenario']=='multi':issues.append('previous_explicit_addendum_adds_answer_observation')
  if row['scenario']=='explicit_semantic':issues.append('previous_addendum_correctly_excludes_latent_unobserved_state')
  reviews.append({'id':row['id'],'scenario':row['scenario'],'observableFault':bool(kinds),'explicitFault':'execution_failure' in kinds,'semanticFault':bool(kinds-{'execution_failure'}),'recovered':row['scenario'] in ('recovered','recovered_quality'),'evaluationPassed':row['trajectory']['evaluation']['status']=='passed','correctObservations':row['gold'],'evidenceScope':[g['evidenceScope'] for g in row['gold']],'forbiddenConclusions':row['forbidden'],'abstainDueToInsufficientEvidence':row['abstainAllowed'],'rootVerified':False,'reviewerIndependent':False,'newRealModelOutputsSeen':False,'labelChangeThisRound':False,'limitations':issues+['single_author_synthetic','no_causal_root_positive','shared_flat_json_scaffold']})
 (B/'gold/REVIEW.json').write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalFileSha256':sha(OLD/'dataset/holdout.jsonl'),'priorAdjudicationSha256':sha(OLD/'dataset/ADJUDICATION.json'),'newLabelChanges':0,'reviewBeforeNewModelOutput':True,'independentHumanGold':False,'caseReviews':reviews},ensure_ascii=False,indent=2),encoding='utf-8')
 (B/'gold/VIEW.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in view),encoding='utf-8')
 # Smoke only uses older DEVELOPMENT fixtures, never the proposed 40-case set.
 sys.path[:0]=[str(OLD/'previous/baseline'),str(OLD/'previous/baseline/previous/data')]
 from build import make
 from test_round2 import constrained
 smoke=[('parameter_closed',constrained()),('answer_mismatch',make('smoke-answer','B')),('stale_result',make('smoke-stale','C')),('normal',make('smoke-normal','normal')),('recovered',make('smoke-recovered','recovered')),('insufficient',make('smoke-missing','missing'))]
 manifest=[]
 for name,row in smoke:
  t=row['trajectory'];assert all(t['trajectoryId']!=r['trajectory']['trajectoryId'] for r in original)
  p=B/'smoke'/(name+'.json');p.write_text(json.dumps(t,ensure_ascii=False,indent=2),encoding='utf-8');manifest.append({'name':name,'file':p.relative_to(B).as_posix(),'sha256':sha(p),'source':'older development fixture, not independent test','traceUtf8Bytes':len(json.dumps(t,ensure_ascii=False,separators=(',',':')).encode()),'expectedSemanticAbstention':name in ('normal','recovered','insufficient')})
 (B/'smoke/CASES.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 freeze={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gitMetadataAvailable':False,'defaultShadowEnabled':False,'platform':{str(p):sha(p) for p in files},'priorDelivery':source['files'],'promptProviderSha256':sha(OLD/'integration/provider.ts'),'auditDatasetSha256':sha(OLD/'dataset/holdout.jsonl'),'goldViewSha256':sha(B/'gold/VIEW.jsonl'),'reviewSha256':sha(B/'gold/REVIEW.json'),'newModelOutputsSeen':False,'paidAuthorization':{'requests':0,'usd':0}}
 (B/'FREEZE.json').write_text(json.dumps(freeze,indent=2),encoding='utf-8')
 print(json.dumps({'frozenPlatformFiles':len(files),'goldCases':len(reviews),'hintFlaggedCases':sum('task_contains_diagnostic_or_answer_hint' in r['limitations'] for r in reviews),'smokeDevelopmentCases':len(smoke),'paidRequests':0}))

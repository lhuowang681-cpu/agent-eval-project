"""Frozen synthetic regression; enhanced-rule Mock is never called real LLM."""
import copy,csv,hashlib,json,sys,time
from pathlib import Path
B=Path(__file__).resolve().parent;sys.path.insert(0,str(B/'previous'))
from vnext.pipeline import diagnose,adapter
from vnext.provider import MockProvider
from baseline.candidate.baseline import generate
SEM={'parameter_task_mismatch','answer_tool_mismatch','stale_information_use'}
def canon(v):return json.dumps(v,sort_keys=True,ensure_ascii=False)
def key(row,o):
 category=o['category'];refs=o.get('evidenceRefs',[])
 if category not in SEM:
  tools={n['id'] for n in row['trajectory']['nodes'] if n['role']=='tool'}
  node=next((r['nodeId'] for r in refs if r['nodeId'] in tools),'missing')
  # Duplicate result records with identical payload are the same event witness.
  if row['scenario']=='duplicate':node=next(n['id'] for n in row['trajectory']['nodes'] if n['role']=='tool')
  return canon(['execution_failure',node])
 c=o['comparison'];return canon([category,c['key'],c['expected'],c['actual']])
def gold_key(g):
 return canon(['execution_failure',g['evidenceScope'][0][0]]) if g['kind']=='execution_failure' else canon([g['kind'],g['key'],g['expected'],g['actual']])
def refs_valid(row,o):
 nodes={n['id']:n for n in row['trajectory']['nodes']};good=0
 for r in o.get('evidenceRefs',[]):
  n=nodes.get(r['nodeId']);v=n.get(r['field']) if n else None;s=v if isinstance(v,str) else canon(v)
  good+=bool(n and r.get('quote') and r['quote'] in s)
 return good,len(o.get('evidenceRefs',[]))
def main():
 target=B/'results/quality.json'
 if target.exists():raise SystemExit('Frozen result exists; replay in copied package')
 frozen=json.loads((B/'dataset/FREEZE.json').read_text(encoding='utf-8'))
 assert all(hashlib.sha256((B/'dataset'/p).read_bytes()).hexdigest()==h for p,h in frozen['files'].items())
 protocol=json.loads((B/'PROTOCOL_FREEZE.json').read_text(encoding='utf-8'));assert all(hashlib.sha256((B/p).read_bytes()).hexdigest()==h for p,h in protocol['files'].items())
 rows=[json.loads(s) for s in (B/'dataset/holdout.jsonl').read_text(encoding='utf-8').splitlines()];byid={r['id']:r for r in rows}
 adjud=json.loads((B/'dataset/ADJUDICATION.json').read_text(encoding='utf-8'))
 for a in adjud['addGold']:byid[a['id']]['gold'].append(a['observation'])
 for a in adjud['excludeUnsupportedGold']:byid[a['id']]['gold']=[g for g in byid[a['id']]['gold'] if g['kind']!=a['kind']]
 records=[];summaries={};csvrows=[]
 for row in rows:
  t=row['trajectory'];before=copy.deepcopy(t);start=time.perf_counter();raw=adapter.analyze(t);candidate=generate(t)
  reviewed=diagnose(t,dict(enabled=True,origin='synthetic',model='enhanced-rule-fixture-NOT-LLM',maxCalls=1,maxTokens=500),MockProvider(candidate));assert t==before
  records.append({'id':row['id'],'trajectory':t,'gold':row['gold'],'rawRuleDiagnostic':raw,'fixedRuleCandidate':candidate,'review':reviewed,'A':raw['observations'],'B_RULE_MOCK_NOT_LLM':raw['observations']+candidate['observations'],'C_RULE_MOCK_REVIEW_NOT_LLM':reviewed['observations'],'offlineElapsedMs':(time.perf_counter()-start)*1000})
 for method in ['A','B_RULE_MOCK_NOT_LLM','C_RULE_MOCK_REVIEW_NOT_LLM']:
  claims=correct=incorrect=unknown=citations=valid=covered=matched=abstain=falsegap=fpnegative=negatives=rootclaims=0;bytype={};newcorrect=newerrors=0
  for row,r in zip(rows,records):
   gold={gold_key(g) for g in row['gold']};pred=r[method];found=set();bad=0
   for o in pred:
    claims+=1;sig=key(row,o);v,n=refs_valid(row,o);valid+=v;citations+=n
    true=sig in gold and o.get('claimLevel')=='observation';rootclaims+=o.get('claimLevel')=='root_cause'
    if true:correct+=1
    elif row['abstainAllowed']:unknown+=1;bad+=1
    else:incorrect+=1;bad+=1
    if true and v==n and n>0:found.add(sig)
   covered+=bool(found&gold);matched+=len(found&gold);abstain+=not pred
   baseGood={key(row,o) for o in r['A'] if key(row,o) in gold and refs_valid(row,o)[0]==refs_valid(row,o)[1]}
   newcorrect+=len(found-baseGood);newerrors+=sum(key(row,o) not in gold for o in pred if key(row,o) not in {key(row,a) for a in r['A']})
   if method=='C_RULE_MOCK_REVIEW_NOT_LLM':
    rawGood={key(row,o) for o in r['B_RULE_MOCK_NOT_LLM'] if key(row,o) in gold and refs_valid(row,o)[0]==refs_valid(row,o)[1]}
    falsegap+=len(rawGood-found)
   negative=row['scenario'] in ('normal','normal_multi','normal_text','nested','legal_base','recovered','recovered_quality')
   negatives+=negative;fpnegative+=bool(negative and bad)
   for g in row['gold']:
    b=bytype.setdefault(g['kind'],{'gold':0,'matched':0});b['gold']+=1;b['matched']+=gold_key(g) in found
   csvrows.append({'id':row['id'],'scenario':row['scenario'],'method':method,'goldCount':len(gold),'claims':len(pred),'matched':len(found&gold),'bad':bad,'abstained':not pred})
  targets=sum(len(r['gold']) for r in rows);positive=sum(bool(r['gold']) for r in rows)
  summaries[method]={'cases':len(rows),'claims':claims,'correct':correct,'incorrect':incorrect,'unknown':unknown,'precision':correct/claims if claims else None,'recall':matched/targets if targets else None,'positiveCases':positive,'coveredCases':covered,'effectiveCoverage':covered/positive if positive else None,'goldObservations':targets,'matchedObservations':matched,'falseSupport':incorrect+unknown if method=='C_RULE_MOCK_REVIEW_NOT_LLM' else None,'falseGap':falsegap if method=='C_RULE_MOCK_REVIEW_NOT_LLM' else None,'abstentions':abstain,'abstentionRate':abstain/len(rows),'validReferences':valid,'references':citations,'citationValidity':valid/citations if citations else None,'normalRecoveredCases':negatives,'normalRecoveredFalsePositiveCases':fpnegative,'normalRecoveredFPR':fpnegative/negatives if negatives else None,'rootClaims':rootclaims,'rootAccuracy':None,'newCorrectVsRules':newcorrect,'newErrorsVsRules':newerrors,'byType':bytype,'realModelLatencyMs':None,'realModelCost':None}
 target.write_text(json.dumps({'datasetKind':'fresh single-author synthetic, not independent human gold','realLLM_B_C':'NOT_RUN_NO_PAID_BUDGET','newRealModelCalls':0,'mockSource':'Enhanced deterministic rules, not oracle and not model inference','summary':summaries,'records':records},ensure_ascii=False,indent=2),encoding='utf-8')
 with (B/'results/per-case.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=csvrows[0]);w.writeheader();w.writerows(csvrows)
 print(json.dumps(summaries,ensure_ascii=True,indent=2))
if __name__=='__main__':main()

"""Frozen offline comparisons. No model API calls, no database writes."""
import copy,hashlib,importlib.util,json,sys
from pathlib import Path
B=Path(__file__).resolve().parent
from vnext.review import explicit_review
from vnext.grouping import analyze
from vnext.pipeline import diagnose
from vnext.provider import MockProvider
from test_system import event
sys.path.insert(0,str(B/'baseline/previous/baseline'))
import adapter,evidence_review
def main():
 f=json.loads((B/'phases/1-3-algorithm-freeze.json').read_text(encoding='utf-8'));assert all(hashlib.sha256((B/p).read_bytes()).hexdigest()==h for p,h in f['files'].items())
 cases=json.loads((B/'phases/1-holdout.json').read_text(encoding='utf-8'));out=[]
 for c in cases:
  t=c['trajectory'];candidate=adapter.analyze(t)['diagnosis'];candidate.update(evidenceRefs=c['refs'],claimLevel=c['claim'])
  old=evidence_review.review_candidate(t,candidate);new=explicit_review(t,c['refs'],c['claim'])
  complete=copy.deepcopy(t);complete['coverage']['complete']=True
  old_complete=evidence_review.review_candidate(complete,candidate)
  out.append({**c,'old':old,'new':new,'oldCounterfactualComplete':old_complete})
 accepted=lambda r:r['new']['decision']=='supported'
 summary={'cases':len(out),'positiveCases':sum(r['expectedLocalAccepted'] for r in out),'oldAccepted':sum(r['old']['support']['status']=='supported' for r in out),'newCorrectAccepts':sum(accepted(r) and r['expectedLocalAccepted'] for r in out),'falseSupport':sum(accepted(r) and not r['expectedLocalAccepted'] for r in out),'falseGap':sum(not accepted(r) and r['expectedLocalAccepted'] for r in out),'singleAuthor':True,'providerCalls':0}
 (B/'results/evidence-quality.json').write_text(json.dumps({'summary':summary,'cases':out},ensure_ascii=False,indent=2),encoding='utf-8')
 # The old 48-case set is a regression, not a fresh holdout or model experiment.
 d=json.loads((B/'baseline/results/case-results.json').read_text(encoding='utf-8'));semantic=[]
 for row in d['dataset']:
  x=diagnose(row['trajectory'],dict(enabled=True,origin='synthetic',model='offline-mock',maxCalls=1,maxTokens=500),MockProvider(row['scriptedCandidate']))
  semantic.append({'id':row['id'],'sidecar':x})
 (B/'results/semantic-regression.json').write_text(json.dumps({'source':'previous 48 cases, regression only','mode':'fixed_candidates_mock_NOT_LLM','newRealCalls':0,'records':semantic},ensure_ascii=False,indent=2),encoding='utf-8')
 events=[event(i) for i in range(99)]+[event(99,recovered=False,taskResult='failed',severity=5,evidenceQuality=3,text='timeout data loss')]+[event(100,tool='b'),event(101,errorContext='connect')]
 reference=B.parent/'source-reference/attribution/cause_convergence.py'
 spec=importlib.util.spec_from_file_location('legacy_grouping',reference);legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
 rows=[{'trace_id':e['traceId'],'failed_tool':e['tool'],'failure_output':'timeout','trace_summary':e['text'],'session_key':e['runId'],'impact_status':'hard_failed' if e['taskResult']=='failed' else 'recovered','evidence_text':'data loss' if e['severity']==5 else ''} for e in events]
 old=legacy.converge(rows);new=analyze(events+[copy.deepcopy(events[0])])
 (B/'results/grouping.json').write_text(json.dumps({'events':events+[copy.deepcopy(events[0])],'legacyActualOutput':old,'candidate':new,'legacySourceSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'scope':'synthetic pattern test, not common root validation'},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'evidence':summary,'semanticMockCases':len(semantic),'oldPatternGroups':len(old['scored_causes']),'newPatternGroups':len(new)}))
if __name__=='__main__':main()

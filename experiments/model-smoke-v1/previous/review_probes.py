"""Post-evaluation diagnostics, NOT additional independent holdout scores."""
import copy,json,sys
from pathlib import Path
B=Path(__file__).resolve().parent;sys.path.insert(0,str(B/'previous'))
from vnext.review import explicit_review
from baseline.candidate.baseline import generate
from baseline.candidate.review import review
if __name__=='__main__':
 rows=[json.loads(s) for s in (B/'dataset/holdout.jsonl').read_text(encoding='utf-8').splitlines()];out=[]
 for row in rows:
  if row['scenario']=='short':
   node=next(n for n in row['trajectory']['nodes'] if n['role']=='tool');r=explicit_review(row['trajectory'],[{'nodeId':node['id'],'field':'content','quote':'service unavailable'}]);assert r['decision']=='supported';out.append({'id':row['id'],'probe':'short_excerpt_same_field_envelope','review':r})
 row=next(r for r in rows if r['scenario']=='answer');base=generate(row['trajectory'])
 for kind in ['root','wrong_value','fake_quote']:
  candidate=copy.deepcopy(base)
  if kind=='root':candidate['observations'][0]['claimLevel']='root_cause'
  if kind=='wrong_value':candidate['observations'][0]['comparison']['expected']='not-in-tool-result'
  if kind=='fake_quote':candidate['observations'][0]['evidenceRefs'][0]['quote']='fabricated'
  r=review(row['trajectory'],candidate);assert not r['supportedObservations'];out.append({'id':row['id'],'probe':kind,'candidate':candidate,'review':r})
 # Historical tests remain historical and unchanged.
 old=json.loads((B/'previous/results/evidence-quality.json').read_text(encoding='utf-8'))
 for c in old['cases']:
  r=explicit_review(c['trajectory'],c['refs'],c['claim']);assert r==c['new']
 (B/'results/review-probes.json').write_text(json.dumps({'newPosthocProbes':out,'historicalVerdictsReproduced':len(old['cases']),'noAlgorithmChanges':True,'notIndependentScores':True},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'posthocProbes':len(out),'historicalVerdicts':len(old['cases'])}))

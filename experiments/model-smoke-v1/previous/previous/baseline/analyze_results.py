"""Offline analysis of saved formal outputs, no candidate modification."""
import json
from pathlib import Path
from evaluate import assess,signature
BASE=Path(__file__).resolve().parent
if __name__=='__main__':
 d=json.loads((BASE/'results/case-results.json').read_text(encoding='utf-8'));gaps=[];removed=[];types={};extra=[]
 for row,r in zip(d['dataset'],d['records']):
  raw=r['C_SCRIPTED_NOT_LLM'];new=r['D_SCRIPTED_reviewed'];old=r['previous_review']
  supported={signature(o) for o in new['observations'] if assess(row,new,o)['adequate']}
  base={signature(o) for o in r['B_reviewed']['observations'] if assess(row,r['B_reviewed'],o)['adequate']}
  if supported-base:extra.append(row['id'])
  for o in raw['observations']:
   if assess(row,raw,o)['adequate'] and signature(o) not in supported:gaps.append({'id':row['id'],'title':row['title'],'observation':o,'reason':next(v['issues'] for v in r['review']['reviews'] if v['id']==o['id'])})
  for o in old['observations']:
   if not assess(row,old,o)['adequate'] and signature(o) not in supported:removed.append({'id':row['id'],'observation':o,'truth':assess(row,old,o)['truth']})
  for g in row['gold']:
   bucket=types.setdefault(g['category'],{'positiveObservations':0,'B_detected':0,'D_detected':0})
   if g['truth']=='correct':
    bucket['positiveObservations']+=1;bucket['B_detected']+=signature(g) in base;bucket['D_detected']+=signature(g) in supported
 result={'falseGaps':gaps,'removedUnsupportedOldAccepts':removed,'byCategory':types,'scriptedSupportedOnlyBeyondEnhancedRules':extra,'warning':'No new model calls. Scripted candidates cannot measure genuine LLM incremental discovery.'}
 (BASE/'results/analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'gaps':len(gaps),'removedUnsupported':len(removed),'byCategory':types,'scriptedExtraBeyondRules':extra}))

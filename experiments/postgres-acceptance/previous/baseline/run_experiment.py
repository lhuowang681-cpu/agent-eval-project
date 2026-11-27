"""Offline formal experiment. No import of the network client, no API keys."""
import copy,csv,hashlib,json,sys,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE/'previous/baseline'))
import adapter
from candidate.baseline import generate,envelope
from candidate.review import review
from candidate.mock import run as mock_run,PROMPT_VERSION,PROMPT
from evaluate import metrics,citation
from reproduce import old
from freeze import hashes

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load():
 rows=[json.loads(s) for s in (BASE/'data/cases.jsonl').read_text(encoding='utf-8').splitlines()]
 byid={r['id']:r for r in rows}
 for c in json.loads((BASE/'data/LABEL_REVIEW.json').read_text(encoding='utf-8'))['corrections']:byid[c['id']]['gold'][c['goldIndex']]['supportable']=c['supportable']
 for c in json.loads((BASE/'data/LABEL_ADDENDUM.json').read_text(encoding='utf-8'))['additions']:byid[c['id']]['gold'].append(c['additionalGold'])
 return rows
def reviewed(t,c,fn=review):
 r=fn(t,c);return envelope(t,r['supportedObservations']),r
def main():
 frozen=json.loads((BASE/'ALGORITHM_FREEZE.json').read_text(encoding='utf-8'));assert frozen['files']==hashes()
 protocol=json.loads((BASE/'PROTOCOL_FREEZE.json').read_text(encoding='utf-8'));assert all(sha(BASE/p)==h for p,h in protocol['files'].items())
 target=BASE/'results/case-results.json'
 if target.exists():raise SystemExit('Formal results already exist. Replay only in a copied package; do not overwrite history.')
 rows=load();records=[];csvrows=[]
 for row in rows:
  t=row['trajectory'];before=copy.deepcopy(t);start=time.perf_counter()
  a=envelope(t,adapter.analyze(t)['observations']);b=generate(t)
  raw=json.dumps(row['scriptedCandidate'],ensure_ascii=False);mock=mock_run(t,raw);assert mock['error'] is None
  c=mock['candidate'];d,dr=reviewed(t,c);br,breview=reviewed(t,b)
  valid=[o for o in c['observations'] if citation(t,c,o)[0]==citation(t,c,o)[1] and c['scope']==t['scope'] and c['inputDigest']==t['inputDigest']]
  old_result=old.review(t,c);old_out=envelope(t,old_result['supportedObservations'])
  record={'id':row['id'],'A_original_rules':a,'B_enhanced_rules':b,'B_reviewed':br,'C_SCRIPTED_NOT_LLM':c,'C_citations_only':envelope(t,valid),'D_SCRIPTED_reviewed':d,'previous_review':old_out,'review':dr,'baselineReview':breview,'oldReview':old_result,'rawMockResponse':raw,'transport':{'model':'offline-fixture-NOT-LLM','promptVersion':PROMPT_VERSION,'prompt':PROMPT,'realCalls':0,'tokenUsage':None,'providerLatency':None,'providerCost':None,'offlineSeconds':round(time.perf_counter()-start,6)}}
  assert t==before;records.append(record)
 methods=['A_original_rules','B_enhanced_rules','B_reviewed','C_SCRIPTED_NOT_LLM','C_citations_only','D_SCRIPTED_reviewed','previous_review']
 summary={}
 for method in methods:
  raw_method='B_enhanced_rules' if method=='B_reviewed' else 'C_SCRIPTED_NOT_LLM' if method in ('C_citations_only','D_SCRIPTED_reviewed','previous_review') else None
  summary[method]=metrics(rows,records,method,raw_method)
  for row,record in zip(rows,records):
   m=metrics([row],[record],method,raw_method)
   csvrows.append({'id':row['id'],'title':row['title'],'method':method,**{k:v for k,v in m.items() if k!='byType'}})
 target.write_text(json.dumps({'mode':'OFFLINE_SCRIPTED_CANDIDATES_NOT_LLM','dataset':rows,'records':records,'summary':summary,'externalCalls':0,'protocolSha256':sha(BASE/'PROTOCOL_FREEZE.json')},ensure_ascii=False,indent=2),encoding='utf-8')
 (BASE/'results/summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
 with (BASE/'results/per-case.csv').open('w',encoding='utf-8-sig',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=csvrows[0].keys());writer.writeheader();writer.writerows(csvrows)
 rejected=[{'id':r['id'],**v} for r in records for v in r['review'].get('reviews',[]) if v['support']!='supported']
 (BASE/'results/rejections.json').write_text(json.dumps(rejected,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(summary,ensure_ascii=True,indent=2))
if __name__=='__main__':main()

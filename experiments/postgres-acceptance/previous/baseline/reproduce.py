"""Reproduce disclosed defects without modifying previous artifacts."""
import copy,importlib.util,json,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE/'previous/data'))
from build import make
from candidate.review import review
spec=importlib.util.spec_from_file_location('old_review',BASE/'previous/shadow/semantic_review.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
def probes():
 a=make('probe-A','A');n=a['trajectory']['nodes'][0]
 n['content']=json.dumps({'year':2025,'task':'Compare 2025 and 2024; both years permitted'})
 a['fixtureCandidate']['observations'][0]['evidenceRefs'][0]['quote']=n['content']
 b=make('probe-B','B');nodes=b['trajectory']['nodes'];dup=copy.deepcopy(nodes[2])
 nodes[2]['content']=json.dumps({'success':True,'data':{'orderId':'probe-B-order','status':'shipped','year':2025}})
 dup.update(id='probe-B-conflict',sequence=3);nodes.insert(3,dup)
 b['fixtureCandidate']['observations'][0]['evidenceRefs'][0].update(nodeId=dup['id'],quote=dup['content'])
 return [a,b]
if __name__=='__main__':
 results=[{'id':r['id'],'trajectory':r['trajectory'],'candidate':r['fixtureCandidate'],'old':old.review(r['trajectory'],r['fixtureCandidate']),'new':review(r['trajectory'],r['fixtureCandidate'])} for r in probes()]
 previous=[]
 for name in ['replay-dev','replay-holdout','real-holdout']:
  d=json.loads((BASE/'previous/results'/f'{name}.json').read_text(encoding='utf-8'))
  rows={r['id']:r for r in map(json.loads,(BASE/'previous/data'/('dev.jsonl' if name.endswith('dev') else 'holdout.jsonl')).read_text(encoding='utf-8').splitlines())}
  for r in d['records']:assert old.review(rows[r['id']]['trajectory'],r['candidate'])==r['review']
  previous.append({'experiment':name,'savedVerdictsReproduced':len(d['records'])})
 (BASE/'results/reproduction.json').write_text(json.dumps({'probes':results,'previous':previous,'externalCalls':0},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'old':[r['old']['decision'] for r in results],'new':[r['new']['decision'] for r in results],'previous':previous}))

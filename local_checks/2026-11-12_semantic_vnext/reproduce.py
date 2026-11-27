"""Disclosed counterexamples plus unchanged prior saved-output reproduction."""
import copy,hashlib,importlib.util,json,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE/'previous/data'))
from build import make
from candidate.review import review
spec=importlib.util.spec_from_file_location('old_review',BASE/'previous/shadow/semantic_review.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)

def probes():
    a=make('probe-A','A');node=a['trajectory']['nodes'][0]
    node['content']=json.dumps({'year':2025,'task':'比较2025年与2024年销售额，查询两个年份均合法'},ensure_ascii=False)
    a['fixtureCandidate']['observations'][0]['evidenceRefs'][0]['quote']=node['content']
    b=make('probe-B','B');nodes=b['trajectory']['nodes'];first=nodes[2];duplicate=copy.deepcopy(first)
    first['content']=json.dumps({'success':True,'data':{'orderId':'probe-B-order','status':'shipped','year':2025}})
    duplicate.update(id='probe-B-conflict',sequence=3);nodes.insert(3,duplicate)
    b['fixtureCandidate']['observations'][0]['evidenceRefs'][0].update(nodeId=duplicate['id'],quote=duplicate['content'])
    return [a,b]

if __name__=='__main__':
    results=[]
    for row in probes():results.append({'id':row['id'],'trajectory':row['trajectory'],'candidate':row['fixtureCandidate'],'old':old.review(row['trajectory'],row['fixtureCandidate']),'new':review(row['trajectory'],row['fixtureCandidate'])})
    previous=[]
    for name in ['replay-dev','replay-holdout','real-holdout']:
        data=json.loads((BASE/'previous/results'/f'{name}.json').read_text())
        rows={r['id']:r for r in map(json.loads,(BASE/'previous/data'/('dev.jsonl' if name.endswith('dev') else 'holdout.jsonl')).read_text(encoding='utf-8').splitlines())}
        for r in data['records']:
            assert old.review(rows[r['id']]['trajectory'],r['candidate'])==r['review']
        previous.append({'experiment':name,'savedVerdictsReproduced':len(data['records']),'realCallsThisRun':0})
    (BASE/'results/reproduction.json').write_text(json.dumps({'probes':results,'previous':previous,'externalCalls':0},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'old':[r['old']['decision'] for r in results],'new':[r['new']['decision'] for r in results],'previous':previous}))

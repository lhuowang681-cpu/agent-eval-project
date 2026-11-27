"""Post-hoc regression probe, explicitly excluded from the frozen holdout score."""
from pathlib import Path
import json,subprocess,sys,time
base=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(base/'baseline'))
import adapter
from test_adapter import payload,tools
rows=tools('mcp','permission denied')
request=payload(rows)
candidate=adapter.analyze(request)['diagnosis']
# A meaningful quoted excerpt, with its original failure envelope still in the
# same cited field. This is not a success-text quote borrowing a separate error.
tool=next(node for node in request['nodes'] if node['role']=='tool')
candidate['evidenceRefs']=[{'nodeId':tool['id'],'field':'content','quote':'permission denied'}]
value={'cases':[{'id':'posthoc-meaningful-content-excerpt','trajectory':request,'candidate':candidate}]}
record={'purpose':'Post-hoc compatibility diagnostic; not independent quality evidence or tuning data. No algorithm changes after this result.','input':value,'engines':{}}
for engine in ['baseline','optimized']:
 command=[sys.executable,'-E','-s','-X','utf8',str(base/'experiment/engine_worker.py'),engine]
 start=time.perf_counter();result=subprocess.run(command,input=json.dumps(value),text=True,encoding='utf-8',capture_output=True,timeout=30)
 assert result.returncode==0,result.stderr
 record['engines'][engine]={'command':command,'exitCode':result.returncode,'seconds':time.perf_counter()-start,'output':json.loads(result.stdout)}
(base/'results/posthoc-compatibility.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({engine:record['engines'][engine]['output']['records'][0]['outcomes']['full'] for engine in record['engines']},ensure_ascii=True))

"""Three-case evaluation over real localhost HTTP; model is original local Mock server."""
from pathlib import Path
import json,sys,time,urllib.request,urllib.parse,traceback
base=Path(__file__).resolve().parent;url=sys.argv[1];mock=sys.argv[2];events=[]
def call(name,data=None,mutation=False):
 endpoint=url+'/trpc/lambda/'+name
 headers={'Content-Type':'application/json','lobe-auth-dev-backend-api':'1'}
 if mutation:req=urllib.request.Request(endpoint,data=json.dumps({'json':data or {}}).encode(),headers=headers,method='POST')
 else:req=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode({'input':json.dumps({'json':data or {}})}),headers=headers)
 with urllib.request.urlopen(req,timeout=50) as r:body=json.load(r)
 if 'error' in body:raise RuntimeError(json.dumps(body['error']))
 return body['result']['data']['json']
try:
 req=urllib.request.Request(mock+'/__mock/config',data=json.dumps({'scenario':'simple','firstTokenDelayMs':0,'tokensPerSecond':0}).encode(),headers={'Content-Type':'application/json'})
 urllib.request.urlopen(req,timeout=5).close()
 agent=call('agent.getBuiltinAgent',{'slug':'inbox'})
 bm=call('agentEval.createBenchmark',{'identifier':'audit-http-'+str(time.time_ns()),'name':'HTTP audit','rubrics':[]},True)
 ds=call('agentEval.createDataset',{'benchmarkId':bm['id'],'identifier':'three','name':'Three synthetic cases','evalMode':'contains'},True)
 call('agentEval.batchCreateTestCases',{'datasetId':ds['id'],'cases':[{'content':{'input':f'Synthetic question {i}','expected':'Mock LLM'},'sortOrder':i} for i in range(3)]},True)
 for version in ['v1','v2']:
  call('agent.updateAgentConfig',{'agentId':agent['id'],'value':{'model':'mock-model','provider':'openai','systemRole':'Synthetic '+version,'plugins':[]}},True)
  run=call('agentEval.createRun',{'datasetId':ds['id'],'targetAgentId':agent['id'],'name':version,'config':{'maxSteps':8,'maxConcurrency':1,'timeout':60000}},True)
  started=call('agentEval.startRun',{'id':run['id']},True)
  deadline=time.monotonic()+60;detail=None
  while time.monotonic()<deadline:
   detail=call('agentEval.getRunDetails',{'id':run['id']})
   # getRunDetails returns the run fields alongside associated data.
   state=detail.get('status') or detail.get('run',{}).get('status')
   if state in {'completed','failed','aborted'}:break
   time.sleep(1)
  events.append({'version':version,'runId':run['id'],'startResponse':started,'detail':detail})
  state=detail.get('status') or detail.get('run',{}).get('status')
  assert state=='completed',(state,detail)
  metrics=detail.get('metrics') or detail.get('run',{}).get('metrics')
  assert metrics['passedCases']==3,metrics
 status='passed'
except Exception as e:
 status='blocked_or_failed';events.append({'errorType':type(e).__name__,'error':str(e)[:1800]});traceback.print_exc()
(base/'results'/'http-three-case-eval.json').write_text(json.dumps({'status':status,'conditions':'Real HTTP/DB/Agent runtime/async eval routes; original local Mock LLM, not model quality evidence; no browser interaction','events':events},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':status,'events':len(events)},ensure_ascii=True))
sys.exit(0 if status=='passed' else 1)

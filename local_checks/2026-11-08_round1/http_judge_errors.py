"""HTTP acceptance for judge infrastructure errors, not model quality.

Uses only the original local Mock LLM. The configured case deliberately receives
plain text instead of structured judge JSON: that must be error, never wrong-answer.
"""
from pathlib import Path
import json, time, urllib.request, urllib.parse, urllib.error, sys, traceback

base = Path(__file__).resolve().parent
url = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:13010'
events=[]

def call(name,data=None,mutation=False):
 headers={'Content-Type':'application/json','lobe-auth-dev-backend-api':'1'}
 endpoint=url+'/trpc/lambda/'+name
 if mutation:
  request=urllib.request.Request(endpoint,data=json.dumps({'json':data or {}}).encode(),headers=headers,method='POST')
 else:
  request=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode({'input':json.dumps({'json':data or {}})}),headers=headers)
 try:
  with urllib.request.urlopen(request,timeout=90) as response: body=json.load(response)
 except urllib.error.HTTPError as error:
  raise RuntimeError(f'{name} HTTP{error.code}: {error.read().decode()[:1200]}') from error
 if 'error' in body: raise RuntimeError(str(body['error']))
 return body['result']['data']['json']

try:
 agent=call('agent.getBuiltinAgent',{'slug':'inbox'})
 call('agent.updateAgentConfig',{'agentId':agent['id'],'value':{'model':'mock-model','provider':'openai','systemRole':'Judge error fixture','plugins':[]}},True)
 bm=call('agentEval.createBenchmark',{'identifier':'judge-errors-'+str(time.time_ns()),'name':'Judge error acceptance','rubrics':[]},True)
 for configured in [False, True]:
  dataset=call('agentEval.createDataset',{'benchmarkId':bm['id'],'identifier':'judge-'+str(time.time_ns()),'name':'Configured invalid JSON' if configured else 'Unconfigured judge','evalMode':'llm-rubric','evalConfig':{'model':'mock-model','provider':'openai','criteria':'Check answer'} if configured else {}},True)
  call('agentEval.batchCreateTestCases',{'datasetId':dataset['id'],'cases':[{'content':{'input':f'Judge error fixture {configured} {i}','expected':'Mock LLM'},'sortOrder':i} for i in range(3)]},True)
  run=call('agentEval.createRun',{'datasetId':dataset['id'],'targetAgentId':agent['id'],'name':'Judge infrastructure error','config':{'maxSteps':8,'timeout':60000}},True)
  call('agentEval.startRun',{'id':run['id']},True)
  deadline=time.monotonic()+150
  while True:
   detail=call('agentEval.getRunDetails',{'id':run['id']})
   if detail['status'] in {'completed','failed','aborted'} or time.monotonic()>deadline: break
   time.sleep(1)
  events.append({'configured':configured,'detail':detail})
  assert detail['status']=='failed',detail['status']
  assert detail['metrics']['errorCases']==3,detail['metrics']
  assert detail['metrics']['failedCases']==0,detail['metrics']
  assert detail['metrics']['completedCases']==3,detail['metrics']
  assert all(t['status']=='error' and t['evalResult'].get('error') for t in detail['topics']),detail['topics']
  if not configured:
   assert all('explicit model and provider' in t['evalResult']['error'] for t in detail['topics']),detail['topics']
 status='passed'
except Exception as error:
 traceback.print_exc()
 status='failed_or_blocked'
 events.append({'errorType':type(error).__name__,'error':str(error)[:2500]})
finally:
 (base/'http'/'judge-errors.json').write_text(json.dumps({'status':status,'conditions':'Real PostgreSQL/HTTP/runtime. Unconfigured and deliberately invalid structured output from original localhost Mock. Valid judge output tested separately with stub runtime, no paid supplier or quality claim.','events':events},ensure_ascii=False,indent=2),encoding='utf-8')
 print(status)
sys.exit(0 if status=='passed' else 1)

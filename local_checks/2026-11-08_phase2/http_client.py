"""Only synthetic localhost HTTP fixtures. No provider credentials or auth cookies logged."""
import json, time, urllib.request, urllib.parse, urllib.error
BASE='http://127.0.0.1:13010'
MOCK='http://127.0.0.1:18088'
def call(name,data=None,mutation=False):
 url=BASE+'/trpc/lambda/'+name
 headers={'Content-Type':'application/json','lobe-auth-dev-backend-api':'1'}
 if mutation: req=urllib.request.Request(url,data=json.dumps({'json':data or {}}).encode(),headers=headers,method='POST')
 else: req=urllib.request.Request(url+'?'+urllib.parse.urlencode({'input':json.dumps({'json':data or {}})}),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=120) as response: body=json.load(response)
 except urllib.error.HTTPError as error:
  raise RuntimeError(f'{name} HTTP {error.code}: {error.read().decode()[:2200]}') from error
 if 'error' in body: raise RuntimeError(str(body['error']))
 return body['result']['data']['json']
def wait_run(run_id,seconds=120):
 deadline=time.monotonic()+seconds
 while True:
  details=call('agentEval.getRunDetails',{'id':run_id})
  if details['status'] in {'completed','failed','aborted','external'}: return details
  if time.monotonic()>deadline: raise TimeoutError(f'Run {run_id} remained {details["status"]}')
  time.sleep(.4)
def fixture_agent():
 agent=call('agent.getBuiltinAgent',{'slug':'inbox'})
 call('agent.updateAgentConfig',{'agentId':agent['id'],'value':{'model':'mock-model','provider':'openai','systemRole':'Phase2 synthetic agent','plugins':[]}},True)
 return agent
def benchmark(name):
 return call('agentEval.createBenchmark',{'identifier':'phase2-'+str(time.time_ns()),'name':name,'rubrics':[]},True)
def dataset(bm,mode,config,cases):
 ds=call('agentEval.createDataset',{'benchmarkId':bm['id'],'identifier':'phase2-'+str(time.time_ns()),'name':'Synthetic '+mode,'evalMode':mode,'evalConfig':config},True)
 call('agentEval.batchCreateTestCases',{'datasetId':ds['id'],'cases':[{'content':value,'sortOrder':index} for index,value in enumerate(cases)]},True)
 return ds
def run_dataset(ds,name,k=1):
 run=call('agentEval.createRun',{'datasetId':ds['id'],'targetAgentId':'inbox','name':name,'config':{'maxSteps':8,'timeout':60000,'k':k}},True)
 call('agentEval.startRun',{'id':run['id']},True)
 return wait_run(run['id'])

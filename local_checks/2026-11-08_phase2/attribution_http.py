"""Increment 2: real persisted executions -> separate durable tasks -> actual Python -> linked results."""
from pathlib import Path
import json, os, subprocess, time, traceback, urllib.request, urllib.error, http.cookiejar
from http_client import call, fixture_agent, benchmark, dataset, run_dataset, MOCK
base=Path(__file__).resolve().parent
platform=base.parent/'2026-11-08_platform_audit'/'platform'
out=base/'increment2'/'http';out.mkdir(exist_ok=True,parents=True)
events=[];status='failed_or_blocked'
def scenario(name):
 body=json.dumps({'scenario':name,'firstTokenDelayMs':0,'tokensPerSecond':0}).encode()
 urllib.request.urlopen(urllib.request.Request(MOCK+'/__mock/config',data=body,headers={'Content-Type':'application/json'}),timeout=10).close()
 urllib.request.urlopen(urllib.request.Request(MOCK+'/__mock/reset',data=b'{}',headers={'Content-Type':'application/json'}),timeout=10).close()
def scores(detail):
 return {'status':detail['status'],'metrics':detail['metrics'],'topics':[{'topicId':t.get('topicId') or t['topic']['id'],'testCaseId':t['testCaseId'],'status':t['status'],'passed':t['passed'],'score':t['score'],'evalResult':t['evalResult']} for t in detail['topics']]}
try:
 agent=fixture_agent();bm=benchmark('Phase2 attribution HTTP acceptance')
 scenario('simple')
 ds=dataset(bm,'contains',{},[{'input':f'Quality failure fixture {time.time_ns()} {i}','expected':'INTENTIONALLY_ABSENT_REFERENCE'} for i in range(3)])
 quality=run_dataset(ds,'Quality failures without established root cause')
 assert quality['metrics']['failedCases']==3,quality
 events.append({'stage':'quality-source-run','detail':quality})
 queued=call('agentEvalExternal.diagnosisRequest',{'runId':quality['id']},True)
 duplicate=call('agentEvalExternal.diagnosisRequest',{'runId':quality['id']},True)
 assert len(queued)==3 and {x['id'] for x in queued}=={x['id'] for x in duplicate},(queued,duplicate)
 assert all(not x['created'] for x in duplicate),duplicate
 events.append({'stage':'idempotent-enqueue','queued':queued,'duplicate':duplicate})
 scenario('eval-tool-failure')
 call('agent.updateAgentConfig',{'agentId':agent['id'],'value':{'plugins':['lobe-calculator'],'model':'mock-model','provider':'openai'}},True)
 ds=dataset(bm,'contains',{},[{'input':'Controlled calculator syntax failure '+str(time.time_ns()),'expected':'INTENTIONALLY_ABSENT_TOOL_SUCCESS'}])
 failed=run_dataset(ds,'Actual failed tool execution')
 assert failed['topics'][0]['status']=='failed',failed
 events.append({'stage':'tool-source-run','detail':failed})
 tool_jobs=call('agentEvalExternal.diagnosisRequest',{'runId':failed['id']},True)
 assert len(tool_jobs)==1,tool_jobs
 before={quality['id']:scores(quality),failed['id']:scores(failed)}
 env={key:value for key,value in os.environ.items() if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
 env.update({'DATABASE_URL':'postgresql://postgres@127.0.0.1:15433/agent_eval_phase2','DATABASE_DRIVER':'node','KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','NODE_ENV':'development','EVAL_ATTRIBUTION_PYTHON':'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'})
 command=['node','--import','tsx','scripts/local/evalAttribution.ts','--user-id','phase2-audit-user','--process-only','--limit','100']
 started=time.perf_counter()
 with (out/'worker.log').open('w',encoding='utf-8') as log:
  result=subprocess.run(command,cwd=platform,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
 events.append({'stage':'actual-python-batch','command':command,'exitCode':result.returncode,'seconds':round(time.perf_counter()-started,3)})
 assert result.returncode==0,'Worker failed; see worker.log'
 for receipt in queued+tool_jobs:
  job=call('agentEvalExternal.diagnosisGet',{'id':receipt['id']})
  trace=call('agentEvalExternal.diagnosisTrace',{'id':receipt['id']})
  events.append({'stage':'diagnostic-result','job':job,'trace':trace})
  assert job['status']=='success',job
  assert job['inputDigest']==trace['inputDigest']==job['result']['inputDigest'],job
  assert job['scope']==trace['scope']==job['result']['scope'],job
  ids={node['id'] for node in trace['nodes']}
  assert all(ref['nodeId'] in ids for obs in job['result']['observations'] for ref in obs['evidenceRefs']),job
  if receipt in queued:
   assert job['result']['diagnosis']['status']=='unknown',job
  else:
   tool_nodes=[n for n in trace['nodes'] if n['role']=='tool']
   assert tool_nodes and any(n['error'] for n in tool_nodes),trace
   assert any(n['toolSource']=='builtin' and n['toolCallId'] for n in tool_nodes),trace
   assert job['result']['observations'],job
   assert job['result']['diagnosis']['status']=='needs_review',job
   assert job['result']['diagnosis']['moduleId'] is None,job
 for run_id,original in before.items():
  current=call('agentEval.getRunDetails',{'id':run_id})
  assert scores(current)==original,(original,scores(current))
  listed=call('agentEvalExternal.diagnosisList',{'runId':run_id})
  assert listed and all(job['scope']['runId']==run_id for job in listed),listed
 events.append({'stage':'original-scoring-unchanged','runIds':list(before)})
 # Prove the raw trace endpoint cannot be read anonymously or by another real session.
 query=urllib.parse.urlencode({'input':json.dumps({'json':{'id':queued[0]['id']}})})
 endpoint='http://127.0.0.1:13010/trpc/lambda/agentEvalExternal.diagnosisTrace?'+query
 try:
  urllib.request.urlopen(endpoint,timeout=30)
  raise AssertionError('Anonymous trace access unexpectedly succeeded')
 except urllib.error.HTTPError as error:
  assert error.code==401,error.code
 jar=http.cookiejar.CookieJar();other=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
 authbody=json.dumps({'email':'phase2-ui@example.com','password':'Phase2LocalOnly2026!'}).encode()
 with other.open(urllib.request.Request('http://127.0.0.1:13010/api/auth/sign-in/email',data=authbody,headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:13010'}),timeout=30) as response: response.read()
 try:
  other.open(endpoint,timeout=30)
  raise AssertionError('Other user trace access unexpectedly succeeded')
 except urllib.error.HTTPError as error:
  assert error.code==404,error.code
 events.append({'stage':'trace-access-isolation','anonymousHTTP':401,'otherSessionHTTP':404})
 status='passed'
except Exception as error:
 traceback.print_exc();events.append({'errorType':type(error).__name__,'error':str(error)[:7000]})
finally:
 try: scenario('simple')
 except Exception: pass
 (out/'results.json').write_text(json.dumps({'status':status,'conditions':'Real PostgreSQL, original runtime/tool executor and HTTP; actual fixed Python child process. Synthetic source executions, not real-user labeled accuracy.','events':events},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'status':status,'events':len(events)}))
raise SystemExit(0 if status=='passed' else 1)

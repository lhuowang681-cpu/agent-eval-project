"""Increment 1 acceptance through real HTTP, PostgreSQL, agent execution and model SDK."""
from pathlib import Path
import json, traceback, urllib.request
from http_client import call, fixture_agent, benchmark, dataset, run_dataset, MOCK
base=Path(__file__).resolve().parent
out=base/'increment1'/'http';out.mkdir(parents=True,exist_ok=True)
events=[];status='failed_or_blocked'
try:
 with urllib.request.urlopen(urllib.request.Request(MOCK+'/__mock/config',data=b'{"scenario":"simple","firstTokenDelayMs":0,"tokensPerSecond":0}',headers={'Content-Type':'application/json'})) as response: response.read()
 fixture_agent();bm=benchmark('Phase2 Judge HTTP acceptance')
 cases=[('valid','llm-rubric','passed',None),('zero','llm-rubric','failed',None),
        ('empty','llm-rubric','error','judge_parse'),('invalid-json','llm-rubric','error','judge_parse'),
        ('out-of-range','llm-rubric','error','judge_invalid_result'),('empty-reason','llm-rubric','error','judge_invalid_result'),
        ('binary-half','answer-relevance','error','judge_invalid_result'),('error','llm-rubric','error','judge_provider'),
        ('timeout','llm-rubric','error','judge_timeout')]
 for variant,mode,expected,error_code in cases:
  config={'model':'mock-judge-'+variant,'provider':'openai','criteria':'PHASE2_CRITERIA: answer the given task with evidence','timeoutMs':1000 if variant=='timeout' else 15000}
  questions=[{'input':'PHASE2_TASK: Which synthetic result is correct?','expected':'PHASE2_EXPECTED: deterministic local fixture'}]
  ds=dataset(bm,mode,config,questions)
  detail=run_dataset(ds,'Judge '+variant)
  event={'variant':variant,'datasetId':ds['id'],'detail':detail};events.append(event)
  assert len(detail['topics'])==1,detail
  topic=detail['topics'][0]
  assert topic['status']==expected,(variant,topic)
  assert topic['evalResult']['scoringSource']=='llm',(variant,topic)
  if error_code:
   assert topic['evalResult']['errorCode']==error_code,(variant,topic)
   assert detail['metrics']['errorCases']==1 and detail['metrics']['failedCases']==0,detail['metrics']
  else:
   assert topic['score']==(1 if variant=='valid' else 0),topic
   assert topic['evalResult']['rubricScores'][0]['reason'],topic
  (out/'progress.json').write_text(json.dumps({'events':events},ensure_ascii=False,indent=2),encoding='utf-8')
 # Read back a legacy alias without requiring a non-executed field as a save switch.
 ds=dataset(bm,'llm-rubric',{'model':'mock-judge-valid','provider':'openai','judgePrompt':'LEGACY_CRITERIA_ALIAS','timeoutMs':15000},[{'input':'Legacy task','expected':'Legacy answer'}])
 events.append({'variant':'legacy-criteria-config','detail':run_dataset(ds,'Legacy config')})
 assert events[-1]['detail']['topics'][0]['status']=='passed'
 ds=dataset(bm,'llm-rubric',{'model':'mock-judge-valid','provider':'openai','criteria':'Thread criterion','timeoutMs':15000},[{'input':'K two task','expected':'Thread answer'}])
 detail=run_dataset(ds,'K2 structured Judge',k=2);events.append({'variant':'k2','detail':detail})
 assert detail['topics'][0]['status']=='passed',detail
 assert len(detail['topics'][0]['evalResult']['threads'])==2,detail
 with urllib.request.urlopen(MOCK+'/__mock/stats') as response: stats=json.load(response)
 requests=stats['judgeRequests']
 assert requests and all(all(item[key] for key in ['hasInput','hasExpected','hasActual','hasCriteria','structured']) for item in requests),requests
 events.append({'stage':'mock-request-context','judgeRequests':requests})
 status='passed'
except Exception as error:
 traceback.print_exc();events.append({'errorType':type(error).__name__,'error':str(error)[:5000]})
finally:
 (out/'results.json').write_text(json.dumps({'status':status,'conditions':'Real PostgreSQL + HTTP + original agent runtime + ModelRuntime SDK to localhost structured Mock. No real supplier or quality inference.','events':events},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'status':status,'events':len(events)}))
raise SystemExit(0 if status=='passed' else 1)

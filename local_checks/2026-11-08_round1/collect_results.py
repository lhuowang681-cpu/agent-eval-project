"""Collect distinct test groups; never count a zero-test or nonzero-exit run as passed."""
from pathlib import Path
import json
base=Path(__file__).resolve().parent
groups=[
 ('Agent Runtime','compression_judge/runtime-after.json','compression_judge/results/runtime-after-command.json'),
 ('Rubric and dataset parser','scoring/after.json','scoring/after-command.json'),
 ('Evaluation database models','regression/db-models-after.json','results/db-models-after-command.json'),
 ('Evaluation service','inbox_alias/service-final.json','inbox_alias/results/service-final-command.json'),
 ('Evaluation routers','inbox_alias/router-final.json','inbox_alias/results/router-final-command.json'),
]
records=[]
for name,result,command in groups:
 data=json.loads((base/result).read_text(encoding='utf-8-sig'))
 cmd=json.loads((base/command).read_text(encoding='utf-8-sig'))
 passed=data['numTotalTests']>0 and data['numPassedTests']==data['numTotalTests'] and data['numFailedTests']==0 and cmd['exitCode']==0
 records.append({'group':name,'total':data['numTotalTests'],'passed':data['numPassedTests'],'failed':data['numFailedTests'],'exitCode':cmd['exitCode'],'verified':passed,'result':result,'command':command,'testFiles':len(data.get('testResults',[]))})
http=json.loads((base/'http/http-three-case-eval.json').read_text(encoding='utf-8'))
judge=json.loads((base/'http/judge-errors.json').read_text(encoding='utf-8'))
ui=json.loads((base/'ui/attempt7/result.json').read_text(encoding='utf-8'))
smoke=json.loads((base/'http/smoke-final.json').read_text(encoding='utf-8'))
typecheck=json.loads((base/'typecheck-summary.json').read_text(encoding='utf-8'))
result={'date':'2026-11-08','selectedDistinctVitestGroups':records,'selectedTotal':sum(x['total'] for x in records),'selectedPassed':sum(x['passed'] for x in records),'allSelectedGroupsPassed':all(x['verified'] for x in records),'realPostgresHttp':http['status'],'judgeInfrastructureErrorHttp':judge['status'],'authenticatedUI':ui['status'],'attribution':'See attribution/results.json: 10 regressions and 4 CLI replays, separate from Vitest.','conditions':'Selected regressions are not whole-repository coverage. Database unit/integration suites use original PGlite fixtures. HTTP/UI use real PostgreSQL and localhost Mock LLM, not real supplier quality.','wholeRepositoryTypeCheck':'not passed; see results/typecheck-final-command.json, results/typecheck-final-8gb-command.json and logs','sourceIntegrity':'source-integrity.json','patchVerification':'patch-verification.json'}
result['finalOriginalHttpSmoke']=smoke
result['finalTypeCheck']=typecheck
(base/'RESULTS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
assert result['allSelectedGroupsPassed'] and result['realPostgresHttp']=='passed' and result['judgeInfrastructureErrorHttp']=='passed' and result['authenticatedUI']=='passed'

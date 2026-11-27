from pathlib import Path
import json,os,subprocess,time
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit'/'platform'
env={key:value for key,value in os.environ.items() if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({'TEST_BASE_URL':'http://127.0.0.1:13010','TEST_MOCK_LLM_URL':'http://127.0.0.1:18088','MOCK_DEV_USER_ID':'phase2-audit-user'})
command=['node','--import','tsx','tools/api-test/smoke.ts'];started=time.perf_counter()
with (base/'http'/'original-smoke-final.log').open('w',encoding='utf-8') as log:
 result=subprocess.run(command,cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
receipt={'command':command,'exitCode':result.returncode,'seconds':round(time.perf_counter()-started,3),'conditions':'Final phase2 source, real PostgreSQL and original localhost Mock, original HTTP/SSE/calculator smoke.'}
(base/'http'/'original-smoke-final.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt));raise SystemExit(result.returncode)

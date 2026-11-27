from pathlib import Path
import hashlib,json,os,subprocess,sys,time
BASE=Path(__file__).resolve().parent
APP=BASE.parent/'2026-11-08_platform_audit/platform'
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({'NODE_ENV':'test','CI':'true','DATABASE_DRIVER':'node','DATABASE_URL':'postgresql://audit:audit@127.0.0.1:15432/audit','KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','EVAL_ATTRIBUTION_PYTHON':sys.executable})
records=[]
for label,cwd,command in [
 ('shadow',BASE,[sys.executable,'-B','test_shadow.py']),
 ('old-python',APP,[sys.executable,'-B','-m','unittest','discover','-s','scripts/eval-attribution','-p','test_*.py','-v']),
 ('old-bridge',APP,['node','node_modules/vitest/vitest.mjs','run','src/server/services/agentEvalAttribution','--environment=node','--maxWorkers=2','--testTimeout=20000','--hookTimeout=60000','--reporter=default','--reporter=json','--outputFile='+str(BASE/'results/old-bridge.json')])]:
 start=time.perf_counter()
 with (BASE/'results'/(label+'.log')).open('w',encoding='utf-8') as out:
  process=subprocess.run(command,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=180)
 records.append({'label':label,'cwd':str(cwd),'command':command,'exitCode':process.returncode,'seconds':round(time.perf_counter()-start,3)})
 print(json.dumps(records[-1]),flush=True)
 if process.returncode:break
(BASE/'results/regression_commands.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
frozen=json.loads((BASE/'SOURCE_FREEZE.json').read_text(encoding='utf-8'))
unchanged=all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in frozen.items())
(BASE/'results/default_unchanged.json').write_text(json.dumps({'files':len(frozen),'unchanged':unchanged,'defaultIntegration':False}),encoding='utf-8')
raise SystemExit(0 if unchanged and len(records)==3 and all(r['exitCode']==0 for r in records) else 1)

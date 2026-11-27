from pathlib import Path
import json,os,subprocess,sys,time,shutil,hashlib
base=Path(__file__).resolve().parents[1]
app=base.parent/'2026-11-08_platform_audit/platform'
# The unchanged provenance test intentionally resolves five parents from HERE.
# Recreate only that small directory layout, rather than editing its assertion.
layout=base/'regression/baseline-layout'
baseline_tests=layout/'local_checks/frozen/platform/scripts/eval-attribution'
baseline_tests.mkdir(parents=True,exist_ok=True)
for item in json.loads((base/'baseline/MANIFEST.json').read_text(encoding='utf-8'))['files']:
 source=base/'baseline'/item['snapshot']
 assert hashlib.sha256(source.read_bytes()).hexdigest()==item['sha256']
 shutil.copyfile(source,baseline_tests/source.name)
provenance=json.loads((base/'baseline/provenance.json').read_text(encoding='utf-8'))
legacy=base.parents[1]/provenance['source']
target=layout/provenance['source'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(legacy,target)
env={key:value for key,value in os.environ.items() if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({'CI':'true','NODE_ENV':'test','DATABASE_DRIVER':'node','DATABASE_URL':'postgresql://audit:audit@127.0.0.1:15432/audit','KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','PYTHONIOENCODING':'utf-8','EVAL_ATTRIBUTION_PYTHON':sys.executable})
commands={
 'baseline-python':([sys.executable,'-B','-m','unittest','discover','-s',str(baseline_tests),'-p','test_*.py','-v'],app,0),
 'policy-before':([sys.executable,'-B',str(base/'regression/test_quality_policy.py'),str(base/'baseline')],app,1),
 'policy-after':([sys.executable,'-B',str(base/'regression/test_quality_policy.py'),str(base/'optimized')],app,0),
 'python-current':([sys.executable,'-B','-m','unittest','discover','-s','scripts/eval-attribution','-p','test_*.py','-v'],app,0),
 'metrics':([sys.executable,'-B',str(base/'regression/test_metrics.py')],app,0),
 'bridge-tasks':(['node','node_modules/vitest/vitest.mjs','run','src/server/services/agentEvalAttribution','--environment=node','--maxWorkers=2','--fileParallelism=true','--testTimeout=20000','--hookTimeout=60000','--reporter=default','--reporter=json','--outputFile='+str(base/'regression/bridge-tasks.json')],app,0),
}
selection=sys.argv[1:] or list(commands)
receipts=[]
for label in selection:
 command,cwd,expected=commands[label];start=time.perf_counter()
 with (base/'regression'/(label+'.log')).open('w',encoding='utf-8') as f:
  try:result=subprocess.run(command,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180);code=result.returncode
  except subprocess.TimeoutExpired:code=124
 record={'label':label,'command':command,'cwd':str(cwd),'exitCode':code,'expectedExitCode':expected,'seconds':round(time.perf_counter()-start,3),'matchedExpectedExit':code==expected}
 (base/'regression'/(label+'-command.json')).write_text(json.dumps(record,indent=2),encoding='utf-8')
 receipts.append(record);print(json.dumps(record),flush=True)
 if code!=expected:break
raise SystemExit(0 if all(x['matchedExpectedExit'] for x in receipts) else 1)

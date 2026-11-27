"""Targeted regressions; logs only in this round's results directory."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,time
BASE=Path(__file__).resolve().parent
APP=BASE.parent/'2026-11-08_platform_audit/platform'
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({'NODE_ENV':'test','CI':'true','DATABASE_DRIVER':'node','DATABASE_URL':'postgresql://audit:audit@127.0.0.1:15432/audit','KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','EVAL_ATTRIBUTION_PYTHON':sys.executable})
def main():
 commands=[('new18',BASE,[sys.executable,'-B','-m','unittest','test_round2','test_metrics']),('previous15',BASE/'previous',[sys.executable,'-B','test_shadow.py']),('originalPython36',APP,[sys.executable,'-B','-m','unittest','discover','-s','scripts/eval-attribution','-p','test_*.py','-v']),('originalBridge71',APP,['node','node_modules/vitest/vitest.mjs','run','src/server/services/agentEvalAttribution','--environment=node','--maxWorkers=2','--testTimeout=20000','--hookTimeout=60000','--reporter=default','--reporter=json','--outputFile='+str(BASE/'results/bridge.json')])]
 records=[]
 for name,cwd,command in commands:
  start=time.perf_counter()
  with (BASE/'results'/(name+'.log')).open('w',encoding='utf-8') as f:run=subprocess.run(command,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180)
  receipt={'label':name,'command':command,'cwd':str(cwd),'exitCode':run.returncode,'seconds':round(time.perf_counter()-start,3)};records.append(receipt);print(json.dumps(receipt),flush=True)
 (BASE/'results/regression.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
 snapshot=json.loads((BASE/'SOURCE_SNAPSHOT.json').read_text(encoding='utf-8'))
 def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
 original=BASE.parent/'2026-11-10_semantic_vnext'
 assert all(sha(original/p)==h and sha(BASE/'previous'/p)==h for p,h in snapshot['previous'].items())
 assert all(sha(Path(p))==h for p,h in snapshot['originalPlatform'].items())
 (BASE/'results/unchanged.json').write_text(json.dumps({'previousFiles':len(snapshot['previous']),'platformFiles':len(snapshot['originalPlatform']),'unchanged':True,'defaultIntegration':False}),encoding='utf-8')
 raise SystemExit(int(any(r['exitCode'] for r in records)))
if __name__=='__main__':main()

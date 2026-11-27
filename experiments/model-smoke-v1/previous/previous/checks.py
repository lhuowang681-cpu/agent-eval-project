from pathlib import Path
import json,os,subprocess,sys,time
B=Path(__file__).resolve().parent;APP=B.parent/'2026-11-08_platform_audit/platform'
def main(phase):
 env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
 env.update(NODE_ENV='test',CI='true',DATABASE_DRIVER='node',DATABASE_URL='postgresql://audit:audit@127.0.0.1:15432/audit',KEY_VAULTS_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',EVAL_ATTRIBUTION_PYTHON=sys.executable)
 commands=[('previous18',B/'baseline',[sys.executable,'-B','-m','unittest','test_round2','test_metrics']),('previous15',B/'baseline/previous',[sys.executable,'-B','test_shadow.py']),('python36',APP,[sys.executable,'-B','-m','unittest','discover','-s','scripts/eval-attribution','-p','test_*.py','-v']),('bridge71',APP,['node','node_modules/vitest/vitest.mjs','run','src/server/services/agentEvalAttribution','--environment=node','--maxWorkers=2','--testTimeout=20000','--hookTimeout=60000','--reporter=default'])]
 receipts=[]
 for name,cwd,cmd in commands:
  start=time.perf_counter()
  with (B/'results'/f'{phase}-{name}.log').open('w',encoding='utf-8') as f:p=subprocess.run(cmd,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180)
  r={'name':name,'command':cmd,'cwd':str(cwd),'exitCode':p.returncode,'seconds':round(time.perf_counter()-start,3)};receipts.append(r);print(json.dumps(r),flush=True)
 (B/'results'/f'{phase}-regression.json').write_text(json.dumps(receipts,indent=2),encoding='utf-8')
 raise SystemExit(int(any(r['exitCode'] for r in receipts)))
if __name__=='__main__':main(sys.argv[1] if len(sys.argv)>1 else '0')

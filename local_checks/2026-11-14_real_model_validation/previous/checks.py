from pathlib import Path
import json,os,subprocess,sys,time
B=Path(__file__).resolve().parent;APP=B.parent/'2026-11-08_platform_audit/platform'
def main():
 env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
 env.update(NODE_ENV='test',CI='true',DATABASE_DRIVER='node',DATABASE_URL='postgresql://audit:audit@127.0.0.1:15432/audit',KEY_VAULTS_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',EVAL_ATTRIBUTION_PYTHON=sys.executable)
 commands=[('new-quality4',B,[sys.executable,'-B','test_quality.py']),('previous14',B/'previous',[sys.executable,'-B','-m','unittest','test_review','test_system']),('previous18',B/'previous/baseline',[sys.executable,'-B','-m','unittest','test_round2','test_metrics']),('previous15',B/'previous/baseline/previous',[sys.executable,'-B','test_shadow.py']),('originalPython36',APP,[sys.executable,'-B','-m','unittest','discover','-s','scripts/eval-attribution','-p','test_*.py','-v']),('ts-score-and-attribution',APP,['node','node_modules/vitest/vitest.mjs','run','src/server/services/agentEvalAttribution','src/server/services/agentEvalRun','--environment=node','--maxWorkers=2','--testTimeout=20000','--hookTimeout=60000','--reporter=default','--reporter=json','--outputFile='+str(B/'results/ts-regression.json')]),('provider-config4',APP,['node','--import','tsx',str(B/'integration/config.test.ts')])]
 records=[]
 for name,cwd,command in commands:
  start=time.perf_counter()
  with (B/'results'/(name+'.log')).open('w',encoding='utf-8') as f:p=subprocess.run(command,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=240)
  record={'name':name,'command':command,'cwd':str(cwd),'exitCode':p.returncode,'seconds':round(time.perf_counter()-start,3)};records.append(record);print(json.dumps(record),flush=True)
 (B/'results/regression.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
 raise SystemExit(int(any(r['exitCode'] for r in records)))
if __name__=='__main__':main()

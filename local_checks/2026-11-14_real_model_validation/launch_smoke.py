"""Read credential without echo; pass only to the child process, never to disk."""
import getpass,json,os,subprocess,sys
from pathlib import Path
B=Path(__file__).resolve().parent
APP=B.parent/'2026-11-08_platform_audit/platform'
if __name__=='__main__':
 grant=json.loads((B/'BUDGET_AUTHORIZATION.json').read_text(encoding='utf-8'))
 if grant.get('approved') is not True:raise SystemExit('Budget not authorized')
 if (B/'results/real-smoke.json').exists():raise SystemExit('Existing smoke result preserved; no repeat')
 key=getpass.getpass('DeepSeek key (hidden, never saved): ')
 env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
 env.update(VNEXT_DEEPSEEK_API_KEY=key,NODE_ENV='test',PYTHONDONTWRITEBYTECODE='1')
 command=['node','--import','tsx',str(B/'integration/smoke.ts'),str(B)]
 with (B/'results/smoke-run.log').open('w',encoding='utf-8') as log:
  result=subprocess.run(command,cwd=APP,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=150)
 env.pop('VNEXT_DEEPSEEK_API_KEY',None);key=''
 print(json.dumps({'exitCode':result.returncode,'log':'results/smoke-run.log','noCredentialSaved':True}))
 raise SystemExit(result.returncode)

"""Run local audit commands with runtime-only environment and preserve logs."""
from pathlib import Path
import subprocess,os,sys,json,time
base=Path(__file__).resolve().parent
label,cwd,*cmd=sys.argv[1:]
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({'NODE_ENV':'test','CI':'true','FORCE_COLOR':'0','PYTHONIOENCODING':'utf-8','NPM_CONFIG_USERCONFIG':str(base/'empty-user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(base/'empty-global.npmrc')})
env.update({'DATABASE_URL':'postgresql://audit:audit@127.0.0.1:15432/audit','DATABASE_DRIVER':'node','KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','NEXT_PUBLIC_APP_URL':'http://127.0.0.1:13010','APP_URL':'http://127.0.0.1:13010','MOCK_DEV_USER_ID':'audit-user','NEXT_TELEMETRY_DISABLED':'1'})
(base/'logs').mkdir(exist_ok=True);(base/'results').mkdir(exist_ok=True)
t=time.perf_counter()
with (base/'logs'/(label+'.log')).open('w',encoding='utf-8') as f:
 try:
  p=subprocess.run(cmd,cwd=base/cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600)
  code=p.returncode
 except subprocess.TimeoutExpired:
  code=124;f.write('\nAUDIT_TIMEOUT_600_SECONDS\n')
record={'label':label,'cwd':cwd,'command':cmd,'exitCode':code,'seconds':round(time.perf_counter()-t,2)}
(base/'results'/(label+'-command.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))
sys.exit(code)



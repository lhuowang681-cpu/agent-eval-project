"""Start isolated real-PG acceptance stack. Ctrl+C stops only owned node processes.

Postgres is pre-initialized separately and remains available until pg_ctl stop.
All model traffic uses the project's original localhost Mock LLM, with fake keys.
"""
from pathlib import Path
import json, os, socket, subprocess, time, sys
import psutil

base = Path(__file__).resolve().parent
app = base.parent / '2026-11-08_platform_audit' / 'platform'
(base / 'http').mkdir(exist_ok=True)
env = {k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update({
 'NODE_ENV':'development','NEXT_TELEMETRY_DISABLED':'1','DATABASE_DRIVER':'node',
 'DATABASE_URL':'postgresql://postgres@127.0.0.1:15433/postgres',
 'KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
 'MOCK_DEV_USER_ID':'round1-audit-user','ENABLE_MOCK_DEV_USER':'0',
 'APP_URL':'http://127.0.0.1:13010','NEXT_PUBLIC_APP_URL':'http://127.0.0.1:13010',
 'INTERNAL_APP_URL':'http://127.0.0.1:13010','PORT':'13010',
 'AUTH_SECRET':'round1-local-synthetic-not-production-secret',
 'AUTH_EMAIL_VERIFICATION':'0','AUTH_DISABLE_EMAIL_PASSWORD':'0',
 'AGENT_RUNTIME_MODE':'local','NODE_OPTIONS':'--max-old-space-size=8192',
 'MOCK_LLM_PORT':'18088','MOCK_SERVICES_PORT':'18089',
 'MOCK_LLM_SCENARIO':'simple','MOCK_LLM_FIRST_TOKEN_MS':'0','MOCK_LLM_TOKENS_PER_SEC':'0',
 'OPENAI_API_KEY':'round1-local-placeholder','OPENAI_PROXY_URL':'http://127.0.0.1:18088/v1',
 'OPENAI_BASE_URL':'http://127.0.0.1:18088/v1',
 'S3_ACCESS_KEY_ID':'round1-local-placeholder','S3_SECRET_ACCESS_KEY':'round1-local-placeholder',
 'S3_BUCKET':'round1','S3_ENDPOINT':'http://127.0.0.1:18089','S3_PUBLIC_DOMAIN':'http://127.0.0.1:18089',
 'S3_REGION':'us-east-1','S3_ENABLE_PATH_STYLE':'1',
 'TEST_BASE_URL':'http://127.0.0.1:13010','TEST_MOCK_LLM_URL':'http://127.0.0.1:18088',
})
env['JWKS_KEY'] = subprocess.check_output(['node','-e',"const {privateKey}=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048});console.log(JSON.stringify({keys:[{...privateKey.export({format:'jwk'}),alg:'RS256',kid:'round1-local'}]}))"],cwd=app,env=env,text=True).strip()
processes=[]
handles=[]

def start(label,args):
 f=(base/'http'/(label+'.log')).open('w',encoding='utf-8')
 handles.append(f)
 p=subprocess.Popen(args,cwd=app,env=env,stdout=f,stderr=subprocess.STDOUT)
 processes.append(p)
 return p

def ready(process,port,timeout=90,host='127.0.0.1'):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if process.poll() is not None: raise RuntimeError(f'process {process.pid} exited {process.returncode}')
  try:
   with socket.create_connection((host,port),timeout=.5): return
  except OSError: time.sleep(.5)
 raise TimeoutError(f'port {port}')

try:
 seed=start('seed',['node','--import','tsx','scripts/local/seedDevUser.ts'])
 if seed.wait(timeout=60): raise RuntimeError('seed failed')
 ready(start('mock-llm',['node','--import','tsx','tools/mock-llm/server.ts']),18088,30)
 ready(start('mock-services',['node','--import','tsx','tools/mock-services/server.ts']),18089,30)
 ready(start('vite',['node','node_modules/vite/bin/vite.js','--port','9876','--host','localhost']),9876,60,'localhost')
 ready(start('next',['node','node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','13010']),13010)
 (base/'http'/'services.json').write_text(json.dumps({'app':'http://127.0.0.1:13010','mock':'http://127.0.0.1:18088','dbPort':15433,'nodePids':[p.pid for p in processes if p.poll() is None],'conditions':'Real PostgreSQL 16.15 + pgvector; BM25 absent; original private dependency stubs; synthetic Mock LLM; no quality or production-performance claim.'},indent=2),encoding='utf-8')
 print('READY http://127.0.0.1:13010 real PostgreSQL :15433, original Mock LLM :18088',flush=True)
 if '--smoke' in sys.argv:
  p=start('original-smoke',['node','--import','tsx','tools/api-test/smoke.ts'])
  exit_code=p.wait(timeout=180)
  (base/'http'/'smoke-final.json').write_text(json.dumps({'command':['node','--import','tsx','tools/api-test/smoke.ts'],'exitCode':exit_code,'log':'original-smoke.log','conditions':'Real PostgreSQL and original local Mock; counts are in the unmodified smoke output.'},indent=2),encoding='utf-8')
  print('original smoke exit',exit_code,flush=True)
 while True:
  if any(p.poll() is not None for p in processes[1:5]): raise RuntimeError('server stopped')
  time.sleep(2)
except KeyboardInterrupt:
 pass
finally:
 for p in reversed(processes):
  try:
   parent=psutil.Process(p.pid)
   owned=parent.children(recursive=True)+[parent]
   for proc in reversed(owned):
    try: proc.terminate()
    except psutil.Error: pass
   _,alive=psutil.wait_procs(owned,timeout=4)
   for proc in alive:
    try: proc.kill()
    except psutil.Error: pass
  except psutil.Error: pass
 for f in handles: f.close()

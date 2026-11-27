"""Start only isolated localhost services; save HTTP probes and stop owned processes."""
from pathlib import Path
import os,sys,socket,time,subprocess,json,urllib.request,urllib.error
import psutil
base=Path(__file__).resolve().parent; app=base/'platform';logs=base/'logs'
mode=sys.argv[1] if len(sys.argv)>1 else 'webpack'
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
dbport,webport=port(),port()
mockport,serviceport=port(),port()
env.update({'NODE_ENV':'development','NEXT_TELEMETRY_DISABLED':'1','DATABASE_DRIVER':'node','DATABASE_URL':f'postgresql://postgres:postgres@127.0.0.1:{dbport}/postgres','PGLITE_PORT':str(dbport),'PGLITE_HOST':'127.0.0.1','PGLITE_DATA_DIR':str(base/'pglite-startup-data'),'KEY_VAULTS_SECRET':'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','MOCK_DEV_USER_ID':'audit-user','APP_URL':f'http://127.0.0.1:{webport}','NEXT_PUBLIC_APP_URL':f'http://127.0.0.1:{webport}','AUTH_SECRET':'audit-only-not-production-secret-0123456789','AGENT_RUNTIME_MODE':'local','NODE_OPTIONS':'--max-old-space-size=8192'})
children=[];handles=[];events=[]
if mode.startswith('api'):
 env.update({'MOCK_LLM_PORT':str(mockport),'MOCK_SERVICES_PORT':str(serviceport),'OPENAI_API_KEY':'audit-local-placeholder','OPENAI_PROXY_URL':f'http://127.0.0.1:{mockport}/v1','OPENAI_BASE_URL':f'http://127.0.0.1:{mockport}/v1','TEST_BASE_URL':f'http://127.0.0.1:{webport}','TEST_MOCK_LLM_URL':f'http://127.0.0.1:{mockport}','ENABLE_MOCK_DEV_USER':'1'})
 if mode in {'api-configured','api-eval'}:
  env.update({'S3_ACCESS_KEY_ID':'audit-local-placeholder','S3_SECRET_ACCESS_KEY':'audit-local-placeholder','S3_BUCKET':'audit','S3_ENDPOINT':f'http://127.0.0.1:{serviceport}','S3_PUBLIC_DOMAIN':f'http://127.0.0.1:{serviceport}','S3_REGION':'us-east-1','S3_ENABLE_PATH_STYLE':'1'})
 if mode=='api-eval':
  jwk=subprocess.check_output(['node','-e',"const {privateKey}=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048});console.log(JSON.stringify({keys:[{...privateKey.export({format:'jwk'}),alg:'RS256',kid:'audit-local'}]}))"],cwd=app,env=env,text=True)
  env.update({'JWKS_KEY':jwk.strip(),'INTERNAL_APP_URL':f'http://127.0.0.1:{webport}'})
def start(label,args):
 f=(logs/(label+'-'+mode+'.log')).open('w',encoding='utf-8');handles.append(f)
 p=subprocess.Popen(args,cwd=app,env=env,stdout=f,stderr=subprocess.STDOUT)
 children.append(p);return p
def wait_tcp(p,n,seconds):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if p.poll() is not None:return False
  try:
   with socket.create_connection(('127.0.0.1',n),timeout=.5):return True
  except OSError:time.sleep(.5)
 return False
try:
 db=start('pglite-startup',['node','--import','tsx','scripts/local/pgliteServer.ts'])
 ready=wait_tcp(db,dbport,75);events.append({'stage':'pglite','tcpReady':ready,'exitCode':db.poll()})
 if ready:
  seed=start('seed-user',['node','--import','tsx','scripts/local/seedDevUser.ts'])
  try:seed.wait(timeout=60)
  except subprocess.TimeoutExpired:seed.terminate()
  events.append({'stage':'seed','exitCode':seed.poll()})
 web=start('next-startup',['node','node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',str(webport)]+(['--webpack'] if mode=='webpack' else []))
 ready=wait_tcp(web,webport,90);events.append({'stage':'next','tcpReady':ready,'exitCode':web.poll()})
 if ready and mode.startswith('api'):
  llm=start('mock-llm',['node','--import','tsx','tools/mock-llm/server.ts']);svc=start('mock-services',['node','--import','tsx','tools/mock-services/server.ts'])
  events.append({'stage':'mocks','llmReady':wait_tcp(llm,mockport,20),'toolsReady':wait_tcp(svc,serviceport,20)})
  smoke=start('api-smoke',([sys.executable,str(base/'http_eval.py'),f'http://127.0.0.1:{webport}',f'http://127.0.0.1:{mockport}'] if mode=='api-eval' else ['node','--import','tsx','tools/api-test/smoke.ts']))
  try:smoke.wait(timeout=150)
  except subprocess.TimeoutExpired:smoke.terminate()
  events.append({'stage':'original-http-smoke','exitCode':smoke.poll(),'timeoutSeconds':150})
 if ready and not mode.startswith('api'):
  for path in ['/','/eval']:
   t=time.monotonic()
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{webport}{path}',timeout=90) as r:
     b=r.read();(base/'results'/('page-root.html' if path=='/' else 'page-eval.html')).write_bytes(b)
     events.append({'stage':'http','path':path,'finalUrl':r.url,'status':r.status,'bytes':len(b),'seconds':round(time.monotonic()-t,2)})
   except urllib.error.HTTPError as e:
    b=e.read();(base/'results'/('page-root-error.html' if path=='/' else 'page-eval-error.html')).write_bytes(b)
    events.append({'stage':'http','path':path,'status':e.code,'bytes':len(b),'seconds':round(time.monotonic()-t,2)})
   except Exception as e:events.append({'stage':'http','path':path,'error':type(e).__name__+': '+str(e),'seconds':round(time.monotonic()-t,2)})
finally:
 for p in reversed(children):
  try:
   proc=psutil.Process(p.pid);desc=proc.children(recursive=True)
   for q in reversed(desc):
    try:q.terminate()
    except psutil.Error:pass
   proc.terminate()
   psutil.wait_procs([proc]+desc,timeout=4)
   for q in [proc]+desc:
    try:
     if q.is_running():q.kill()
    except psutil.Error:pass
  except psutil.Error:pass
 for f in handles:f.close()
 (base/'results'/('startup-'+mode+'.json')).write_text(json.dumps({'mode':mode,'ports':{'database':dbport,'next':webport},'events':events,'allOwnedProcessesStopped':True,'conditions':'PGlite without BM25; private dependencies use original stubs; no model credentials supplied; no browser interaction tested'},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(events,ensure_ascii=True))

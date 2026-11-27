import hashlib,json,os,pathlib,subprocess,sys,time
base=pathlib.Path(__file__).resolve().parent
variant=sys.argv[1]
if variant not in {'baseline','round1-snapshot'}:raise SystemExit('Unknown audit variant')
cwd=base/variant
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
env.update(NODE_OPTIONS='--max-old-space-size=8192',NODE_ENV='test',CI='true',FORCE_COLOR='0')
cmd=['node','node_modules/typescript/bin/tsc','--noEmit','--pretty','false','--tsBuildInfoFile',str(base/(variant+'.tsbuildinfo')),'--listFiles']
started=time.perf_counter()
with (base/(variant+'.log')).open('w',encoding='utf-8') as out:
 try:
  code=subprocess.run(cmd,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=600).returncode
 except subprocess.TimeoutExpired:
  code=124;out.write('\nTIMEOUT_600_SECONDS\n')
record={'command':cmd,'cwd':str(cwd),'nodeOptions':env['NODE_OPTIONS'],'exitCode':code,'seconds':round(time.perf_counter()-started,2),'tsconfigSha256':hashlib.sha256((cwd/'tsconfig.json').read_bytes()).hexdigest()}
(base/(variant+'-command.json')).write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps(record))
raise SystemExit(code)

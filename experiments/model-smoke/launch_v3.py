import getpass,json,os,subprocess
from pathlib import Path
B=Path(__file__).resolve().parent
if __name__=='__main__':
 if (B/'results/real-smoke-v3.json').exists():raise SystemExit('Existing results preserved')
 key=getpass.getpass('DeepSeek key (hidden, never saved): ')
 env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SYSTEMDRIVE'}}
 env.update(VNEXT_DEEPSEEK_API_KEY=key,NODE_ENV='test')
 with (B/'results/real-run-v3.log').open('w',encoding='utf-8') as f:p=subprocess.run(['node','--import','tsx',str(B/'integration/run-v3.ts'),str(B)],cwd=B.parents[1]/'platform',env=env,stdout=f,stderr=subprocess.STDOUT,timeout=150)
 env.pop('VNEXT_DEEPSEEK_API_KEY',None);key='';print(json.dumps({'exitCode':p.returncode,'keySaved':False}));raise SystemExit(p.returncode)

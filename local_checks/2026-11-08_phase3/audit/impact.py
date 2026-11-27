from pathlib import Path
import json,os,subprocess
base=Path(__file__).resolve().parents[1]
checks=base.parent
env=dict(os.environ);env['GITNEXUS_HOME']=str(checks/'2026-11-08_round1/gitnexus-home')
cli=checks/'2026-11-08_round1/tooling/node_modules/gitnexus/dist/cli/index.js'
app=checks/'2026-11-08_platform_audit/platform'
records=[]
for symbol in ['review_candidate','audited_candidate','observed_category']:
 cmd=['node',str(cli),'impact',symbol,'--direction','upstream','-r',str(app),'--include-tests']
 result=subprocess.run(cmd,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=45)
 records.append({'symbol':symbol,'command':cmd,'exitCode':result.returncode,'output':result.stdout+result.stderr})
(base/'audit/IMPACT.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'symbol':x['symbol'],'exitCode':x['exitCode'],'output':x['output'][-650:]} for x in records]))

"""Check/apply exported patch only to an isolated pristine fixture, then compare hashes."""
from pathlib import Path
import hashlib, json, subprocess, zipfile
base=Path(__file__).resolve().parent
project=base.parents[1]
manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
integrity=json.loads((base/'source-integrity.json').read_text(encoding='utf-8'))
stage=base/'patch-verification'
stage.mkdir(exist_ok=True)
prefix='somethingelse-main-main/somethingelse-main/codinganalysis/lobehub/'
with zipfile.ZipFile(manifest['source_archive']) as archive:
 for item in integrity['changedPlatformFiles']:
  dest=stage/item['path']
  if item['kind']!='modified':
   if dest.exists() and dest.resolve().is_relative_to(stage.resolve()): dest.unlink()
   continue
  dest.parent.mkdir(exist_ok=True,parents=True)
  dest.write_bytes(archive.read(prefix+item['path']))
events=[]
for arguments in [['git','apply','--check','--ignore-space-change',str(base/'platform.patch')],['git','apply','--ignore-space-change',str(base/'platform.patch')]]:
 result=subprocess.run(arguments,cwd=stage,capture_output=True,text=True)
 events.append({'command':arguments,'exitCode':result.returncode,'output':result.stdout+result.stderr})
 if result.returncode:
  break
actual=[]
if all(x['exitCode']==0 for x in events) and len(events)==2:
 for item in integrity['changedPlatformFiles']:
  target=stage/item['path']
  # Git may normalize working-tree newlines on Windows; source content is the proof.
  expected=(base.parent/'2026-11-08_platform_audit'/'platform'/item['path']).read_text(encoding='utf-8-sig')
  actual.append({'path':item['path'],'matches':target.read_text(encoding='utf-8-sig')==expected})
record={'events':events,'files':actual,'passed':len(actual)==len(integrity['changedPlatformFiles']) and all(x['matches'] for x in actual)}
(base/'patch-verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':record['passed'],'fileCount':len(actual),'commands':events},ensure_ascii=True))
raise SystemExit(0 if record['passed'] else 1)

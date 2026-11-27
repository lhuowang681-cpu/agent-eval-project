"""Restore only files exactly matching our frozen candidate; preserve both versions."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit/platform'
before=json.loads((base/'baseline/MANIFEST.json').read_text(encoding='utf-8'))['files']
after=json.loads((base/'optimized/MANIFEST.json').read_text(encoding='utf-8'))['files']
changed=[(a,b) for a,b in zip(before,after) if a['sha256']!=b['sha256']]
for old,new in changed:
 assert old['path']==new['path']
 current=app/old['path']
 assert hashlib.sha256(current.read_bytes()).hexdigest()==new['sha256'],'Unexpected intervening edit; stop rather than overwrite'
 assert hashlib.sha256((base/'baseline'/old['snapshot']).read_bytes()).hexdigest()==old['sha256']
restored=[]
for old,new in changed:
 target=app/old['path'];shutil.copyfile(base/'baseline'/old['snapshot'],target)
 restored.append({'path':old['path'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'matchesBaseline':hashlib.sha256(target.read_bytes()).hexdigest()==old['sha256']})
record={'restoredAtUtc':datetime.now(timezone.utc).isoformat(),'reason':'Candidate failed quality promotion; no holdout retuning.','files':restored,'passed':all(x['matchesBaseline'] for x in restored),'candidateRetained':True}
(base/'RESTORE_RECEIPT.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps({'restored':len(restored),'passed':record['passed']}))

from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit/platform'
target=base/'optimized'
if (target/'MANIFEST.json').exists():raise SystemExit('Already frozen; do not overwrite after holdout access.')
target.mkdir(exist_ok=True)
files=[]
for item in json.loads((base/'baseline/MANIFEST.json').read_text(encoding='utf-8'))['files']:
 source=app/item['path'];dest=target/item['snapshot'];shutil.copyfile(source,dest)
 files.append({'path':item['path'],'snapshot':dest.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'baselineSha256':item['sha256']})
decision=hashlib.sha256((base/'OPTIMIZATION_DECISION.md').read_bytes()).hexdigest()
record={'frozenAtUtc':datetime.now(timezone.utc).isoformat(),'decisionSha256':decision,'implementationAgentHasReadHoldoutDetails':False,'files':files,'retuningAfterHoldoutAllowed':False}
(target/'MANIFEST.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps({'files':len(files),'decisionSha256':decision,'frozenAtUtc':record['frozenAtUtc']}))

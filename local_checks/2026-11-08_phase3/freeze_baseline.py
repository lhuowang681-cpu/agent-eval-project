"""Preserve the exact pre-optimization Python entrypoints and bridge source hashes."""
from pathlib import Path
import hashlib,json,shutil
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit/platform'
dest=base/'baseline'
if (dest/'MANIFEST.json').exists():
 print('Baseline already frozen; refusing to overwrite.');raise SystemExit(0)
dest.mkdir(exist_ok=True,parents=True)
files=[]
for path in sorted((app/'scripts/eval-attribution').glob('*')):
 if path.suffix not in {'.py','.json','.md'}:continue
 target=dest/path.name;shutil.copyfile(path,target)
 files.append({'path':path.relative_to(app).as_posix(),'snapshot':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
bridge=[]
for path in sorted((app/'src/server/services/agentEvalAttribution').glob('*.ts')):
 bridge.append({'path':path.relative_to(app).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(dest/'MANIFEST.json').write_text(json.dumps({'source':'Phase2 final platform working copy','files':files,'bridgeHashes':bridge},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'frozenFiles':len(files),'bridgeHashes':len(bridge)}))

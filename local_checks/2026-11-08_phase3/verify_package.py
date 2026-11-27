"""Verify the standard-library offline experiment using only files extracted from ZIP."""
from pathlib import Path
import hashlib,json,subprocess,sys,zipfile
base=Path(__file__).resolve().parent
archive=base.parents[1]/'第三轮归因质量评估与实验材料_2026-11-08.zip'
dest=base/'package-verification';dest.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as z:
 for name in z.namelist():
  target=(dest/name).resolve();assert target.is_relative_to(dest.resolve())
  if name.endswith('/'):target.mkdir(exist_ok=True,parents=True)
  else:target.parent.mkdir(exist_ok=True,parents=True);target.write_bytes(z.read(name))
root=dest/'phase3'
command=[sys.executable,'-B','-X','utf8','experiment/run.py','data/development.jsonl','portable-replay']
result=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',timeout=60)
assert result.returncode==0,result.stderr
for engine in ['baseline','optimized']:
 original=json.loads((base/'results/development'/(engine+'-outputs.json')).read_text(encoding='utf-8'))
 replay=json.loads((root/'results/portable-replay'/(engine+'-outputs.json')).read_text(encoding='utf-8'))
 assert replay['modelCalls']==0 and Path(replay['engineDirectory']).is_relative_to(root)
 a={r['id']:r for r in original['records']};b={r['id']:r for r in replay['records']}
 assert set(a)==set(b)
 for identifier in a:
  for method in a[identifier]['outcomes']:
   clean=lambda x:{k:v for k,v in x.items() if k!='localSeconds'}
   assert clean(a[identifier]['outcomes'][method])==clean(b[identifier]['outcomes'][method])
validation=subprocess.run([sys.executable,'-B','-X','utf8','validate_holdout.py'],cwd=root/'holdout',capture_output=True,text=True,encoding='utf-8',timeout=30)
assert validation.returncode==0,validation.stderr
paths=[root/'experiment/run.py',root/'experiment/engine_worker.py',root/'experiment/metrics.py',root/'data/development.jsonl']
for engine in ['baseline','optimized']:
 paths.extend(p for p in (root/engine).iterdir() if p.is_file())
record={'command':command,'exitCode':result.returncode,'developmentCases':12,'methodsPerEngine':5,'versions':2,'outputsMatchSavedIgnoringTiming':True,'realModelCalls':0,'holdoutEngineRerun':False,'holdoutHashValidatorExitCode':validation.returncode,'noPlatformOrNodeDependenciesUsed':True,'replayedSourceEntries':[{'path':p.relative_to(dest).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]}
(base/'PACKAGE_REPLAY.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in record.items() if k!='replayedSourceEntries'}))

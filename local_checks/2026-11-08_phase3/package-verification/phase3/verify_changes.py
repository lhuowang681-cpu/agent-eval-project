"""Verify only expected small source edits, protected references, patch and rollback."""
from pathlib import Path
import difflib,hashlib,json,subprocess
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit/platform'
project=base.parents[1]
before=json.loads((base/'baseline/MANIFEST.json').read_text(encoding='utf-8'))
after=json.loads((base/'optimized/MANIFEST.json').read_text(encoding='utf-8'))
patch=[];changes=[]
for old,new in zip(before['files'],after['files']):
 assert old['path']==new['path']
 initial=base/'baseline'/old['snapshot'];frozen=base/'optimized'/new['snapshot'];current=app/new['path']
 assert hashlib.sha256(initial.read_bytes()).hexdigest()==old['sha256']
 assert hashlib.sha256(frozen.read_bytes()).hexdigest()==new['sha256']
 assert current.read_bytes()==initial.read_bytes(),'Default source must match restored baseline: '+str(current)
 if initial.read_bytes()==frozen.read_bytes():continue
 lines=list(difflib.unified_diff(initial.read_text(encoding='utf-8').splitlines(keepends=True),frozen.read_text(encoding='utf-8').splitlines(keepends=True),fromfile='a/'+old['path'],tofile='b/'+old['path']))
 for line in lines:patch.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
 changes.append({'path':old['path'],'baselineSha256':old['sha256'],'sha256':new['sha256'],'addedLines':sum(x.startswith('+') and not x.startswith('+++') for x in lines),'removedLines':sum(x.startswith('-') and not x.startswith('---') for x in lines)})
assert {Path(x['path']).name for x in changes}=={'evidence_review.py','test_evidence_review.py','engine-version.json','README.md'}
patch_path=base/'platform-phase3.patch';patch_path.write_text(''.join(patch),encoding='utf-8',newline='\n')
stage=base/'patch-verification';stage.mkdir(exist_ok=True)
for item in changes:
 target=stage/item['path'];assert target.resolve().is_relative_to(stage.resolve());target.parent.mkdir(parents=True,exist_ok=True)
 target.write_bytes((base/'baseline'/Path(item['path']).name).read_bytes())
events=[];matches=[]
for flags,expected in [(['--check'],None),([],base/'optimized'),(['-R','--check'],None),(['-R'],base/'baseline')]:
 cmd=['git','apply','--ignore-space-change',*flags,str(patch_path)]
 result=subprocess.run(cmd,cwd=stage,capture_output=True,text=True)
 events.append({'command':cmd,'exitCode':result.returncode,'output':result.stdout+result.stderr})
 if result.returncode:break
 if expected is not None:
  for item in changes:
   reference=expected/Path(item['path']).name
   matches.append({'phase':'apply' if expected==base/'optimized' else 'rollback','path':item['path'],'matches':(stage/item['path']).read_text(encoding='utf-8')==reference.read_text(encoding='utf-8')})
refs=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))['files']
protected=[{'path':x['path'],'matches':hashlib.sha256((project/x['path']).read_bytes()).hexdigest()==x['sha256']} for x in refs]
record={'changedFiles':changes,'algorithmFrozenBeforeHoldout':True,'candidatePromoted':False,'currentSourceMatchesBaseline':True,'optimizedSnapshotUnchanged':True,'adapterAndPureClassifierUnchanged':(base/'baseline/adapter.py').read_bytes()==(base/'optimized/adapter.py').read_bytes() and (base/'baseline/rules_pure.py').read_bytes()==(base/'optimized/rules_pure.py').read_bytes(),'patchCommands':events,'patchComparisons':matches,'patchAndRollbackVerified':len(events)==4 and len(matches)==2*len(changes) and all(x['exitCode']==0 for x in events) and all(x['matches'] for x in matches),'originalReferences':len(protected),'originalReferencesUnchanged':all(x['matches'] for x in protected)}
(base/'SOURCE_CHANGES.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'changedFiles':len(changes),'patchAndRollbackVerified':record['patchAndRollbackVerified'],'originalReferencesUnchanged':record['originalReferencesUnchanged']}))
raise SystemExit(0 if record['patchAndRollbackVerified'] and record['originalReferencesUnchanged'] else 1)

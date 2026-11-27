"""Export minimal source changes and verify preserved source-reference snapshots."""
from pathlib import Path
import difflib, hashlib, json, zipfile

base=Path(__file__).resolve().parent
project=base.parents[1]
platform=base.parent/'2026-11-08_platform_audit'/'platform'
manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
prefix='somethingelse-main-main/somethingelse-main/codinganalysis/lobehub/'
patch=[]
changes=[]
checked=0
with zipfile.ZipFile(manifest['source_archive']) as archive:
 for info in archive.infolist():
  if info.is_dir() or not info.filename.startswith(prefix): continue
  relative=info.filename[len(prefix):]
  current=platform/relative
  if not current.is_file(): continue
  original=archive.read(info)
  actual=current.read_bytes()
  checked+=1
  if original==actual: continue
  try:
   before=original.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True)
   after=actual.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True)
  except UnicodeDecodeError:
   changes.append({'path':relative,'binary':True})
   continue
  diff=list(difflib.unified_diff(before,after,fromfile='a/'+relative,tofile='b/'+relative))
  patch.extend(diff)
  changes.append({'path':relative,'kind':'modified','sha256':hashlib.sha256(actual).hexdigest(),'addedLines':sum(x.startswith('+') and not x.startswith('+++') for x in diff),'removedLines':sum(x.startswith('-') and not x.startswith('---') for x in diff)})
new_files=[
 'packages/eval-rubric/__tests__/boundaries.test.ts',
 'packages/eval-dataset-parser/__tests__/jsonl-lines.test.ts',
 'src/server/services/agentEvalRun/__tests__/agentEvalRunService.judge.test.ts',
 'src/server/services/agentEvalRun/__tests__/localCompletion.integration.test.ts',
 'src/server/routers/lambda/__tests__/integration/agentEval.inboxAlias.integration.test.ts',
]
for relative in new_files:
 actual=(platform/relative).read_bytes()
 after=actual.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True)
 patch.extend(difflib.unified_diff([],after,fromfile='/dev/null',tofile='b/'+relative))
 changes.append({'path':relative,'kind':'added','sha256':hashlib.sha256(actual).hexdigest(),'addedLines':len(after),'removedLines':0})
(base/'platform.patch').write_text(''.join(patch),encoding='utf-8',newline='\n')
protected=[]
for entry in manifest['files']:
 current=project/entry['path']
 digest=hashlib.sha256(current.read_bytes()).hexdigest()
 protected.append({'path':entry['path'],'unchanged':digest==entry['sha256']})
record={'archiveFilesCompared':checked,'changedPlatformFiles':changes,'protectedReferenceFiles':len(protected),'protectedReferenceUnchanged':all(x['unchanged'] for x in protected),'referenceDifferences':[x for x in protected if not x['unchanged']],'note':'Runtime/build outputs, installed dependencies, and local graph index are not source changes. Original archive was read only.'}
(base/'source-integrity.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'compared':checked,'changedFiles':len(changes),'protectedUnchanged':record['protectedReferenceUnchanged'],'paths':[x['path'] for x in changes]},ensure_ascii=True))

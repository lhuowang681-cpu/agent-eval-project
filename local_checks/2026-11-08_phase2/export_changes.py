"""Export phase2 changes against the verified immutable round1 source snapshot."""
from pathlib import Path
import difflib,hashlib,json,os

base=Path(__file__).resolve().parent
project=base.parents[1]
platform=base.parent/'2026-11-08_platform_audit'/'platform'
baseline=base/'audit/types/round1-snapshot'
hashes=json.loads((base/'audit/types/snapshot-source-hashes.json').read_text(encoding='utf-8'))
original={item['path']:item['sha256'] for item in hashes}
changed=[];patch=[]
def add(relative,before,after,kind):
 before_lines=before.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True)
 after_lines=after.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True)
 lines=list(difflib.unified_diff(before_lines,after_lines,fromfile='a/'+relative if kind=='modified' else '/dev/null',tofile='b/'+relative))
 # A source without a trailing newline needs Git's explicit marker; joining raw
 # difflib lines would otherwise concatenate the next file header into the hunk.
 for line in lines:
  patch.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
 changed.append({'path':relative,'kind':kind,'sha256':hashlib.sha256(after).hexdigest(),'baselineSha256':hashlib.sha256(before).hexdigest() if kind=='modified' else None,'addedLines':sum(line.startswith('+') and not line.startswith('+++') for line in lines),'removedLines':sum(line.startswith('-') and not line.startswith('---') for line in lines)})
for relative in original:
 current=platform/relative
 if not current.is_file(): raise RuntimeError('Missing original source: '+relative)
 before=(baseline/relative).read_bytes();after=current.read_bytes()
 if hashlib.sha256(before).hexdigest()!=original[relative]: raise RuntimeError('Frozen baseline changed: '+relative)
 if before!=after: add(relative,before,after,'modified')
skip={'node_modules','dist','build','coverage','__pycache__','tmp','temp','logs','test-results','playwright-report'}
for folder,dirs,files in os.walk(platform,followlinks=False):
 parent=Path(folder)
 dirs[:]=[name for name in dirs if name not in skip and not name.startswith('.') and not (parent/name).is_symlink() and not (parent/name).is_junction()]
 for name in files:
  current=parent/name;relative=current.relative_to(platform).as_posix()
  if relative in original or current.suffix not in {'.ts','.tsx','.mts','.cts','.py','.json','.md'}: continue
  # Generated acceptance records belong outside the platform; only source trees are exported.
  if not relative.startswith(('src/','packages/','scripts/','tools/')): continue
  add(relative,b'',current.read_bytes(),'added')
manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
reference=[{'path':entry['path'],'unchanged':hashlib.sha256((project/entry['path']).read_bytes()).hexdigest()==entry['sha256']} for entry in manifest['files']]
record={'baseline':'Verified round1-snapshot physical source copy','baselineFilesVerified':len(original),'changedFiles':changed,'protectedReferences':len(reference),'referencesUnchanged':all(item['unchanged'] for item in reference),'referenceDifferences':[item for item in reference if not item['unchanged']]}
(base/'platform-phase2.patch').write_text(''.join(patch),encoding='utf-8',newline='\n')
(base/'SOURCE_CHANGES.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'baselineFiles':len(original),'changedFiles':len(changed),'newFiles':sum(x['kind']=='added' for x in changed),'referencesUnchanged':record['referencesUnchanged']},ensure_ascii=True))

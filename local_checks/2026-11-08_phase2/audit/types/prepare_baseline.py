"""Restore pristine archive source; shadow workspace junctions instead of linking all node_modules."""
import hashlib,json,pathlib,shutil,os,zipfile
base=pathlib.Path(__file__).resolve().parent
project=base.parents[3]
current=project/'local_checks/2026-11-08_platform_audit/platform'
baseline=base/'baseline'
baseline.mkdir(exist_ok=True)
extraction=json.loads((current.parent/'extraction.json').read_text(encoding='utf-8'))
manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
excluded=set(extraction['excluded'])
hashes=[]
with zipfile.ZipFile(manifest['source_archive']) as archive:
 for info in archive.infolist():
  if info.is_dir() or not info.filename.startswith(extraction['sourceRoot']):continue
  rel=info.filename[len(extraction['sourceRoot']):]
  parts=pathlib.PurePosixPath(rel).parts
  if rel in excluded or not (current/rel).is_file():continue
  if any(p in {'node_modules','.next','.git','.gitnexus','.pglite-data'} for p in parts):continue
  if any(p.startswith('.env') for p in parts) or '.npmrc' in parts:continue
  data=archive.read(info)
  target=baseline/rel
  target.parent.mkdir(parents=True,exist_ok=True)
  target.write_bytes(data)
  hashes.append({'path':rel,'sha256':hashlib.sha256(data).hexdigest(),'currentSha256':hashlib.sha256((current/rel).read_bytes()).hexdigest()})
# Keep generated Next typing context equal; it is environmental evidence, not pristine archive source.
generated=[]
for folder in ['.next/types','.next/dev/types']:
 src=current/folder
 if src.exists():
  for file in src.rglob('*'):
   if file.is_file():
    rel=file.relative_to(current)
    dst=baseline/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dst)
    generated.append({'path':rel.as_posix(),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
links=[]
def mirror(deps,out):
 out.mkdir(parents=True,exist_ok=True)
 for entry in deps.iterdir():
  dst=out/entry.name
  if entry.is_dir():
   if entry.name.startswith('@') and not os.path.isjunction(entry) and not entry.is_symlink():
    mirror(entry,dst);continue
   resolved=entry.resolve()
   try:
    rel=resolved.relative_to(current)
    workspace=not ('node_modules' in rel.parts)
   except ValueError:workspace=False
   target=(baseline/rel) if workspace else resolved
   links.append({'path':str(dst),'target':str(target),'workspaceRemapped':workspace})
  elif entry.is_file():
   shutil.copyfile(entry,dst)
for directory,dirs,files in os.walk(current,followlinks=False):
 dirs[:]=[d for d in dirs if d not in {'.next','.git','.gitnexus','.pglite-data'} and not os.path.isjunction(pathlib.Path(directory)/d)]
 if 'node_modules' in dirs:
  dirs.remove('node_modules')
  mirror(pathlib.Path(directory)/'node_modules',baseline/pathlib.Path(directory).relative_to(current)/'node_modules')
(base/'baseline-source-hashes.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
(base/'generated-type-context.json').write_text(json.dumps(generated,indent=2),encoding='utf-8')
(base/'dependency-links.json').write_text(json.dumps(links,indent=2),encoding='utf-8')
print(json.dumps({'sourceFiles':len(hashes),'changedAgainstRound1':sum(h['sha256']!=h['currentSha256'] for h in hashes),'generatedTypes':len(generated),'dependencyJunctions':len(links),'remappedWorkspaceJunctions':sum(x['workspaceRemapped'] for x in links)}))

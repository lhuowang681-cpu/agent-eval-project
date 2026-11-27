import hashlib,json,pathlib,shutil
base=pathlib.Path(__file__).resolve().parent
project=base.parents[3]
current=project/'local_checks/2026-11-08_platform_audit/platform'
snapshot=base/'round1-snapshot'
baseline=base/'baseline'
hashes=json.loads((base/'baseline-source-hashes.json').read_text(encoding='utf-8'))
integrity=json.loads((project/'local_checks/2026-11-08_round1/source-integrity.json').read_text(encoding='utf-8'))
paths=[h['path'] for h in hashes]+[h['path'] for h in integrity['changedPlatformFiles'] if h.get('kind')=='added']
records=[]
for rel in paths:
 source=current/rel;target=snapshot/rel
 target.parent.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(source,target)
 records.append({'path':rel,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
for h in json.loads((base/'generated-type-context.json').read_text(encoding='utf-8')):
 target=snapshot/h['path'];target.parent.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(baseline/h['path'],target)
links=json.loads((base/'dependency-links.json').read_text(encoding='utf-8'))
new_links=[]
for link in links:
 path=snapshot/pathlib.Path(link['path']).relative_to(baseline)
 path.parent.mkdir(parents=True,exist_ok=True)
 target=snapshot/pathlib.Path(link['target']).relative_to(baseline) if link['workspaceRemapped'] else pathlib.Path(link['target'])
 new_links.append({**link,'path':str(path),'target':str(target)})
(base/'snapshot-dependency-links.json').write_text(json.dumps(new_links,indent=2),encoding='utf-8')
(base/'snapshot-source-hashes.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
checks=[h for h in records if hashlib.sha256((current/h['path']).read_bytes()).hexdigest()!=h['sha256']]
(base/'snapshot-freeze-check.json').write_text(json.dumps({'files':len(records),'distinctCopies':True,'changedDuringFreeze':checks},indent=2),encoding='utf-8')
print(json.dumps({'files':len(records),'changedDuringFreeze':len(checks),'canUnlockBusinessEdits':not checks}))

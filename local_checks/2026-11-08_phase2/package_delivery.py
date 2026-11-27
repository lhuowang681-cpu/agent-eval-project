"""Archive reviewable changes/evidence only; exclude source baselines and dependencies."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, re, zipfile
import psutil

base=Path(__file__).resolve().parent
project=base.parents[1]
app=base.parent/'2026-11-08_platform_audit/platform'
ports={13010,9876,18088,18089,15433}
listeners=[{'port':x.laddr.port,'address':x.laddr.ip,'pid':x.pid} for x in psutil.net_connections(kind='tcp') if x.status==psutil.CONN_LISTEN and x.laddr.port in ports]
cleanup={'recordedAtUtc':datetime.now(timezone.utc).isoformat(),'method':'psutil TCP LISTEN inventory; not connection-refused probing','ports':sorted(ports),'remainingListeners':listeners,'passed':not listeners,'data':'Acceptance database retained; no recursive deletion.'}
(base/'CLEANUP.json').write_text(json.dumps(cleanup,indent=2),encoding='utf-8')
assert not listeners, listeners

redactions=[]
for path in (base/'http').glob('*.log'):
 value=path.read_text(encoding='utf-8',errors='replace')
 value,count=re.subn(r"authorizationHeader:\s*(['\"])[^'\"\r\n]*\1", "authorizationHeader: '[redacted-session-token]'",value)
 value,count2=re.subn(r'Bearer\s+[A-Za-z0-9_.=-]{20,}', 'Bearer [redacted-session-token]',value)
 if count+count2:
  path.write_text(value,encoding='utf-8')
  redactions.append({'path':path.relative_to(base).as_posix(),'count':count+count2})
(base/'REDACTIONS.json').write_text(json.dumps({'scope':'Ephemeral authorization values only; request/status/error evidence retained.','files':redactions},indent=2),encoding='utf-8')

skip={'baseline','round1-snapshot','patch-verification','__pycache__','node_modules','.gitnexus','tmp','temp'}
entries=[]
for folder,dirs,files in os.walk(base,followlinks=False):
 parent=Path(folder)
 dirs[:]=[x for x in dirs if x not in skip and not x.startswith('.') and not (parent/x).is_symlink() and not (parent/x).is_junction()]
 for name in files:
  path=parent/name
  if path.suffix in {'.pyc','.tsbuildinfo','.zip'} or name in {'DELIVERY_INTEGRITY.json'}: continue
  entries.append((path,'phase2/'+path.relative_to(base).as_posix()))
changes=json.loads((base/'SOURCE_CHANGES.json').read_text(encoding='utf-8'))
for item in changes['changedFiles']:
 path=app/item['path']
 assert hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'],item['path']
 entries.append((path,'changed-source/'+item['path']))
manifest=[{'path':name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path,name in entries]
archive=project/'第二阶段修复与验收材料_2026-11-08.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for path,name in entries: z.write(path,name)
 z.writestr('MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for item in manifest:
  assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256'],item['path']
record={'archive':archive.name,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'entries':len(entries)+1,'allEntryHashesVerified':True,'changedSourceFiles':len(changes['changedFiles']),'originalReferencesUnchanged':changes['referencesUnchanged'],'dependenciesAndDatabaseIncluded':False,'ephemeralAuthorizationValuesRedacted':sum(x['count'] for x in redactions)}
(base/'DELIVERY_INTEGRITY.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))

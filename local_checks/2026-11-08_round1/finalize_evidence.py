"""Redact authentication values in synthetic server logs and package review evidence."""
from pathlib import Path
import hashlib, json, re, zipfile
import psutil
base=Path(__file__).resolve().parent
redactions=[]
for log in (base/'http').glob('*.log'):
 original=log.read_text(encoding='utf-8',errors='replace')
 updated,count=re.subn(r"authorizationHeader:\s*(['\"])[^'\"\r\n]*\1", "authorizationHeader: '[REDACTED_SYNTHETIC_AUTH]'", original)
 if count:
  log.write_text(updated,encoding='utf-8')
  redactions.append({'path':str(log.relative_to(base)),'field':'authorizationHeader','count':count})
(base/'log-redactions.json').write_text(json.dumps({'note':'Only synthetic authentication field values redacted; assertions, SQL errors, statuses, metrics and line ordering retained.','files':redactions},ensure_ascii=False,indent=2),encoding='utf-8')
prior=base/'cleanup.json'
if prior.exists() and not (base/'cleanup-socket-probe.json').exists():
 (base/'cleanup-socket-probe.json').write_bytes(prior.read_bytes())
connections=psutil.net_connections(kind='tcp')
ports=[]
for port in [13010,9876,18088,18089,15433]:
 listeners=[{'address':str(x.laddr),'pid':x.pid} for x in connections if x.laddr and x.laddr.port==port and x.status==psutil.CONN_LISTEN]
 ports.append({'port':port,'state':'still_listening' if listeners else 'stopped','listeners':listeners})
(base/'cleanup.json').write_text(json.dumps({'ports':ports,'method':'Windows TCP listening table via psutil; closed-port socket probes time out on this host and were not treated as proof.','allCheckedServicesStopped':all(x['state']=='stopped' for x in ports),'dataPreserved':True},ensure_ascii=False,indent=2),encoding='utf-8')
assert all(x['state']=='stopped' for x in ports),ports

output=base/'修复与验收材料_2026-11-08.zip'
allowed={'.md','.json','.log','.py','.cjs','.ps1','.mts','.patch','.png','.txt'}
subdirs=['scoring','attribution','compression_judge','completion','inbox_alias','ui','regression','logs','results','http']
files=[p for p in base.iterdir() if p.is_file() and p.suffix.lower() in allowed]
for folder in subdirs:
 files.extend(p for p in (base/folder).rglob('*') if p.is_file() and p.suffix.lower() in allowed and not any(part in {'tmp','__pycache__','node_modules','run-temp'} for part in p.relative_to(base).parts))
integrity=json.loads((base/'source-integrity.json').read_text(encoding='utf-8'))
platform=base.parent/'2026-11-08_platform_audit'/'platform'
manifest=[]
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
 for path in sorted(set(files)):
  relative=path.relative_to(base).as_posix()
  data=path.read_bytes()
  archive.writestr(relative,data)
  manifest.append({'path':relative,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
 for item in integrity['changedPlatformFiles']:
  data=(platform/item['path']).read_bytes()
  relative='platform-files/'+item['path']
  archive.writestr(relative,data)
  manifest.append({'path':relative,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
 archive.writestr('DELIVERY_MANIFEST.json',json.dumps({'scope':'Patch, changed files, reproducible acceptance harness and evidence; requires the original platform and its dependencies. No database binaries, node_modules or production credentials.','files':manifest},ensure_ascii=False,indent=2))
receipt={'archive':output.name,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'fileCount':len(manifest)+1}
(base/'delivery.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'cleanup':ports,'delivery':receipt},ensure_ascii=True))

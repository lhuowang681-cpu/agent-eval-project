from pathlib import Path
import collections,json,os
base=Path(__file__).resolve().parent
app=base.parent/'2026-11-08_platform_audit/platform'
skip={'node_modules','.git','.gitnexus','.next','.pglite-data','.agent-tracing','.test-logs','.conductor','.cache','.pnpm-store','__pycache__','coverage','.turbo','.vercel','test-results','playwright-report','dist','out','release','logs','tmp','temp','.temp','.local','.mcd-tools'}
counts=collections.Counter();sizes=collections.Counter();large=[];sensitive_names=[];links=[]
for folder,dirs,files in os.walk(app,followlinks=False):
 parent=Path(folder)
 keep=[]
 for name in dirs:
  p=parent/name
  if name in skip:continue
  if p.is_symlink() or p.is_junction():links.append(p.relative_to(app).as_posix());continue
  if p.relative_to(app).as_posix() in {'public/spa','docker-compose/dev/data'}:continue
  keep.append(name)
 dirs[:]=keep
 for name in files:
  p=parent/name;relative=p.relative_to(app).as_posix()
  if name.startswith('.env') or name.endswith('.env') or name in {'.npmrc','.yarnrc.yml','.mcp.json'} or p.suffix.lower() in {'.pem','.key','.p12','.pfx','.pkl','.sqlite','.db'}:
   sensitive_names.append(relative);continue
  if p.suffix.lower() in {'.log','.pyc','.tsbuildinfo','.zip','.exe','.dll','.conda'}:continue
  group=relative.split('/')[0];counts[group]+=1;sizes[group]+=p.stat().st_size
  if p.stat().st_size>5*1024*1024:large.append({'path':relative,'bytes':p.stat().st_size})
record={'files':sum(counts.values()),'bytes':sum(sizes.values()),'counts':dict(counts),'sizes':dict(sizes),'large':large,'excludedCredentialLikeFilenames':sensitive_names,'skippedLinks':links}
(base/'FULL_TREE_AUDIT.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))

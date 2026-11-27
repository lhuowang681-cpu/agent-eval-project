from pathlib import Path
import collections,json,zipfile
base=Path(__file__).resolve().parent
project=base.parents[1]
manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
source=Path(manifest['source_archive'])
output=project/'Agent评测系统_完整项目源码_2026-11-09.zip'
original_platform='somethingelse-main-main/somethingelse-main/codinganalysis/lobehub/'
current_platform='agent-eval-project/local_checks/2026-11-08_platform_audit/platform/'
groups={};omitted=collections.defaultdict(lambda:{'files':0,'bytes':0,'compressedBytes':0});other=[]
with zipfile.ZipFile(source) as original,zipfile.ZipFile(output) as current:
 names=set(current.namelist())
 for info in original.infolist():
  if info.is_dir():continue
  rel=info.filename.removeprefix('somethingelse-main-main/somethingelse-main/')
  group='/'.join(rel.split('/')[:2]) if '/' in rel else rel
  item=groups.setdefault(group,{'files':0,'bytes':0,'compressedBytes':0})
  item['files']+=1;item['bytes']+=info.file_size;item['compressedBytes']+=info.compress_size
  if not info.filename.startswith(original_platform):continue
  relative=info.filename[len(original_platform):]
  if current_platform+relative in names:continue
  parts=Path(relative).parts;name=Path(relative).name.lower()
  if '.pglite-data' in parts:category='database_runtime_data'
  elif any(x in parts for x in ['node_modules','.git','.gitnexus','.next','.agent-tracing','.test-logs','__pycache__','dist','out','logs','coverage','tmp','temp','.conductor']):category='dependency_build_cache_log'
  elif name.startswith('.env') or name.endswith('.env') or name in {'.npmrc','.mcp.json','vertex-ai-key.json'} or relative=='docker-compose/production/grafana/init_data.json':category='environment_or_private_initialization'
  elif Path(relative).suffix in {'.pyc','.tsbuildinfo','.log','.exe','.dll','.zip','.conda','.pem','.key','.p12','.pfx'} or name in {'rebuild.test.txt','vitest-exit.txt'}:category='generated_or_prebuilt_or_private'
  else:category='other_requires_review';other.append(relative)
  item=omitted[category];item['files']+=1;item['bytes']+=info.file_size;item['compressedBytes']+=info.compress_size
 full=json.loads(current.read('agent-eval-project/FULL_SOURCE_MANIFEST.json'))
record={'originalArchiveBytes':source.stat().st_size,'newArchiveBytes':output.stat().st_size,'newUncompressedBytes':full['sourceBytes'],'newPlatformFiles':full['platformFiles'],'originalTopGroups':sorted([{'group':name,**item} for name,item in groups.items()],key=lambda x:x['compressedBytes'],reverse=True),'omittedFromOriginalPlatform':dict(omitted),'otherOmittedPaths':other,'postgresBinaryArchiveBytes':(base.parent/'2026-11-08_round1/postgresql-16.15.zip').stat().st_size}
(base/'SIZE_COMPARISON.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))

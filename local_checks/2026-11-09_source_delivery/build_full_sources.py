"""Bundle the whole current source workspace, excluding credentials and generated data."""
from pathlib import Path
import collections,hashlib,json,os,re,zipfile

base=Path(__file__).resolve().parent
project=base.parents[1]
app=base.parent/'2026-11-08_platform_audit/platform'
entries={};exclusions=[];overrides={};sanitizations=[];fixture_markers=[]
skip={'node_modules','.git','.gitnexus','.next','.pglite-data','.agent-tracing','.test-logs','.conductor','.cache','.pnpm-store','__pycache__','coverage','.turbo','.vercel','test-results','playwright-report','dist','out','release','logs','tmp','temp','.temp','.local','.mcd-tools','patch-verification','patch_verification','baseline-layout','package-verification','postgres-portable','baseline','round1-snapshot'}
def blocked(path,relative):
 name=path.name.lower()
 if name.startswith('.env') or name.endswith('.env') or name in {'.npmrc','.yarnrc.yml','.mcp.json','vertex-ai-key.json'}:return 'private environment or credential configuration'
 if path.suffix.lower() in {'.pem','.key','.p12','.pfx','.db','.sqlite','.sqlite3','.pyc','.tsbuildinfo','.log','.zip','.exe','.dll','.conda'}:return 'credential, database, cache, log or prebuilt archive/binary'
 if relative.startswith(('docker-compose/dev/data/','public/spa/','scripts/clerk-to-betterauth/prod/','scripts/clerk-to-betterauth/test/')):return 'generated SPA/database or account migration data'
 if relative=='docker-compose/production/grafana/init_data.json':return 'deployment initialization data containing a private signing key; supply fresh local configuration'
 if name in {'rebuild.test.txt','vitest-exit.txt'}:return 'local command output'
 return None
def add_tree(folder,archive_prefix,extra_skip=()):
 for directory,dirs,files in os.walk(folder,followlinks=False):
  parent=Path(directory)
  kept=[]
  for name in dirs:
   child=parent/name;relative=child.relative_to(folder).as_posix()
   if name in skip or name in extra_skip or child.is_symlink() or child.is_junction() or relative in {'public/spa','docker-compose/dev/data'}:
    exclusions.append({'path':archive_prefix+'/'+relative+'/','reason':'dependency, generated data/cache, prior duplicate baseline or link'});continue
   kept.append(name)
  dirs[:]=kept
  for name in files:
   path=parent/name;relative=path.relative_to(folder).as_posix()
   reason=blocked(path,relative)
   if reason:exclusions.append({'path':archive_prefix+'/'+relative,'reason':reason});continue
   entries[archive_prefix+'/'+relative]=path

prefix='agent-eval-project'
platform_prefix=prefix+'/local_checks/2026-11-08_platform_audit/platform'
add_tree(app,platform_prefix)
for folder in ['source-reference','docs','study_pack','.github']:
 source=project/folder
 if source.exists():add_tree(source,prefix+'/'+folder)
for name in ['README.md','HANDOFF.md','SOURCE_MANIFEST.json']:
 entries[prefix+'/'+name]=project/name

# Preserve local support scripts using their actual project-relative layout.
for phase in ['2026-11-08_round1','2026-11-08_phase2','2026-11-08_phase3']:
 folder=base.parent/phase
 if phase=='2026-11-08_round1':
  for path in folder.iterdir():
   if path.is_file() and path.suffix in {'.py','.ps1','.cjs','.md','.json'}:entries[prefix+'/local_checks/'+phase+'/'+path.name]=path
  for sub in ['attribution','scoring','tooling']:
   if (folder/sub).exists():add_tree(folder/sub,prefix+'/local_checks/'+phase+'/'+sub)
 elif phase=='2026-11-08_phase2':
  add_tree(folder,prefix+'/local_checks/'+phase,extra_skip={'http','ui','tooling','audit'})
 else:
  # These are the small frozen Python algorithms, not full-platform baseline copies.
  phase_skip=skip-{'baseline'}
  original_skip=skip;skip=phase_skip
  add_tree(folder,prefix+'/local_checks/'+phase)
  skip=original_skip

for name in ['extraction.json','FINAL_ASSESSMENT.md']:
 path=app.parent/name
 if path.exists():entries[prefix+'/local_checks/2026-11-08_platform_audit/'+name]=path

# Desktop packaging source assets were omitted during the original local restore;
# recover these non-credential source assets directly from the user's original ZIP.
source_manifest=json.loads((project/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
extraction=json.loads((app.parent/'extraction.json').read_text(encoding='utf-8'))
recovered={}
with zipfile.ZipFile(source_manifest['source_archive']) as archive:
 for relative in extraction['excluded']:
  if not relative.startswith('apps/desktop/build/') or Path(relative).suffix.lower() not in {'.png','.ico','.icns','.bmp','.plist'}:continue
  recovered[platform_prefix+'/'+relative]=archive.read(extraction['sourceRoot']+relative)

# Check high-confidence embedded secret forms without opening excluded .env files.
signals=[]
patterns={'openai_token':r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{28,}\b','github_token':r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b','aws_access_id':r'\bAKIA[A-Z0-9]{16}\b','google_api_key':r'\bAIza[A-Za-z0-9_-]{35}\b','private_key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'}
text_suffix={'.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.json','.yaml','.yml','.toml','.md','.txt','.html','.xml'}
for name,path in entries.items():
 if path.suffix.lower() not in text_suffix:continue
 try:text=path.read_text(encoding='utf-8-sig')
 except UnicodeDecodeError:continue
 is_test='/__tests__/' in name or '.test.' in name
 for kind,pattern in patterns.items():
  matches=list(re.finditer(pattern,text));count=len(matches)
  if not count:continue
  if is_test and kind in {'openai_token','github_token','aws_access_id','google_api_key'} and all(any(marker in match.group().lower() for marker in ['test','example','dummy','mock']) for match in matches):
   fixture_markers.append({'path':name,'kind':kind,'count':count,'reason':'Explicit test/example/mock literal, not a real credential'});continue
  if is_test and kind=='private_key':
   bodies=re.findall(r'[REDACTED_PRIVATE_KEY]',text,re.S)
   if bodies and all(len(body)<40 and any(marker in body.lower() for marker in ['test','mock','dummy']) for body in bodies):
    fixture_markers.append({'path':name,'kind':kind,'count':count,'reason':'Short literal test body, not an encoded private key'});continue
  if name.endswith('/packages/database/src/repositories/dataImporter/__tests__/fixtures/with-client-id.json') and kind=='openai_token':
   safe=re.sub(pattern,'[REDACTED_API_KEY]',text)
   json.loads(safe)
   overrides[name]=safe.encode('utf-8')
   sanitizations.append({'path':name,'kind':kind,'count':count,'originalSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'exportSha256':hashlib.sha256(overrides[name]).hexdigest(),'scope':'Export copy only; original fixture untouched'})
   continue
  signals.append({'path':name,'kind':kind,'count':count})
(base/'FULL_SOURCE_SECRET_SCAN.json').write_text(json.dumps({'signals':signals,'exportOnlySanitizations':sanitizations,'explicitTestMarkersRetained':fixture_markers,'note':'Excluded private environment and private deployment seed files were not opened by this packager. No source workspace files modified.'},indent=2),encoding='utf-8')
if signals:
 print(json.dumps({'requiresReview':signals},ensure_ascii=True));raise SystemExit(2)

# Verify current applied files and restoration against saved acceptance hashes.
applied={x['path']:x['sha256'] for x in json.loads((base.parent/'2026-11-08_round1/source-integrity.json').read_text(encoding='utf-8'))['changedPlatformFiles']}
applied.update({x['path']:x['sha256'] for x in json.loads((base.parent/'2026-11-08_phase2/SOURCE_CHANGES.json').read_text(encoding='utf-8'))['changedFiles']})
for relative,digest in applied.items():
 assert platform_prefix+'/'+relative in entries
 assert hashlib.sha256((app/relative).read_bytes()).hexdigest()==digest,relative
for item in json.loads((base.parent/'2026-11-08_phase3/RESTORE_RECEIPT.json').read_text(encoding='utf-8'))['files']:
 assert hashlib.sha256((app/item['path']).read_bytes()).hexdigest()==item['sha256']

generated={}
generated[platform_prefix+'/.env.example']=b'''# Safe local-development template. No real credentials included.\nAPP_URL=http://127.0.0.1:13010\nNEXT_PUBLIC_APP_URL=http://127.0.0.1:13010\nDATABASE_DRIVER=node\nDATABASE_URL=postgresql://postgres@127.0.0.1:15433/agent_eval_phase2\n# Set fresh secrets locally before starting. Never use placeholders in production.\nAUTH_SECRET=REPLACE_WITH_LOCAL_RANDOM_SECRET\nKEY_VAULTS_SECRET=REPLACE_WITH_32_BYTE_BASE64_SECRET\n# Configure a model provider or use the repository local Mock launcher.\nOPENAI_API_KEY=\n'''
readme='''# 完整项目源码（2026-11-09）

这份是整个当前项目源码，不是修改文件增量包。

## 先找这里

- `local_checks/2026-11-08_platform_audit/platform/`：完整的当前平台工作副本，含src、packages、apps、测试、静态资源、配置、pnpm-lock.yaml及本机私包stubs；第一轮和第二阶段改动已经在内。
- `platform/scripts/eval-attribution/`（以上平台目录内部）：当前实际接入的Python诊断代码。
- `source-reference/`：原始离线归因/报表及运行时参考，保持原文件；旧入口有外部依赖，阅读不等于可直接运行。
- `local_checks/2026-11-08_round1/`：本地运行辅助脚本、独立规则修复/测试及说明。
- `local_checks/2026-11-08_phase2/`：Judge/桥接的辅助代码与验收摘要。
- `local_checks/2026-11-08_phase3/`：归因质量研究、数据/脚本、原版与候选。optimized仅研究，未推广；当前平台使用已恢复的默认审核。
- `study_pack/index.html`：新课程离线阅读；`docs/`保留此前文档。

完整保留业务源码和测试；一处旧导入测试fixture含疑似API Key，仅在导出副本替换为占位符，详见EXPORT_SANITIZATIONS.json，未改本机原文件。旧部署init_data.json包含私钥，因此不携带，需要部署时用自己的初始化配置。

## 启动环境

这是完整源码，不是已安装运行环境。node_modules、构建缓存、实际数据库、PostgreSQL二进制及真实环境文件没有打包；需要另行准备依赖和数据库。平台含私有SDK依赖，本机验收使用的stubs已保留，不能保证换电脑直接pnpm install就全部成功。

本地启动条件与已有演示步骤见local_checks/2026-11-08_phase2/DEMO.md及serve_local.py、start_postgres.ps1。路径结构保留，可读脚本的原相对路径；便携PostgreSQL二进制需自行准备。安全的.env.example仅为新模板，不是原calcifer.env或真实配置。

默认包含上两轮已验证修改。第三轮候选没有因局部开发改善就升级默认；未验证真实模型质量和生产root gold。此轮只整理源码，不重跑全部平台测试，也不声称新电脑环境已通过。

完整性清单见FULL_SOURCE_MANIFEST.json；排除项见EXCLUDED_FILES.json。缺少的桌面打包图标等源资源已从原始源码ZIP恢复。排除真实凭据、运行数据/日志、依赖和重复的整仓基线，不裁剪正常业务源代码。
'''
generated[prefix+'/00_完整源码说明.md']=readme.encode('utf-8')
generated[prefix+'/EXCLUDED_FILES.json']=json.dumps(exclusions,ensure_ascii=False,indent=2).encode('utf-8')
generated[prefix+'/EXPORT_SANITIZATIONS.json']=json.dumps(sanitizations,ensure_ascii=False,indent=2).encode('utf-8')
manifest=[]
for name,path in entries.items():
 value=overrides[name] if name in overrides else path.read_bytes()
 manifest.append({'path':name,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest(),'source':'export-copy-redacted-test-fixture' if name in overrides else 'current-workspace'})
for name,value in recovered.items():manifest.append({'path':name,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest(),'source':'recovered-original-desktop-source-asset'})
for name,value in generated.items():manifest.append({'path':name,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest(),'source':'delivery-note-or-safe-template'})
assert len({x['path'] for x in manifest})==len(manifest)
platform_files=[x for x in manifest if x['path'].startswith(platform_prefix+'/')]
record={'date':'2026-11-09','kind':'full-current-source-workspace-not-incremental','platformDirectory':'local_checks/2026-11-08_platform_audit/platform','platformFiles':len(platform_files),'allFilesBeforeManifest':len(manifest),'sourceBytes':sum(x['bytes'] for x in manifest),'currentAppliedFilesVerified':len(applied),'thirdRoundCandidatePromoted':False,'restoredDesktopSourceAssets':len(recovered),'realEnvironmentFilesRead':False,'generatedSafeEnvironmentTemplate':True,'files':manifest}
output=project/'Agent评测系统_完整项目源码_2026-11-09.zip'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
 for name,path in entries.items():
  if name in overrides:z.writestr(name,overrides[name])
  else:z.write(path,name)
 for name,value in recovered.items():z.writestr(name,value)
 for name,value in generated.items():z.writestr(name,value)
 z.writestr(prefix+'/FULL_SOURCE_MANIFEST.json',json.dumps(record,ensure_ascii=False,indent=2))
with zipfile.ZipFile(output) as z:
 assert z.testzip() is None
 for item in manifest:assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256'],item['path']
receipt={'archive':str(output),'zipBytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'platformFiles':len(platform_files),'totalFiles':len(manifest)+1,'uncompressedBytes':record['sourceBytes'],'appliedFilesVerified':len(applied),'recoveredDesktopSourceAssets':len(recovered),'allEntryHashesVerified':True,'thirdRoundCandidatePromoted':False}
(base/'FULL_SOURCE_DELIVERY.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=True))

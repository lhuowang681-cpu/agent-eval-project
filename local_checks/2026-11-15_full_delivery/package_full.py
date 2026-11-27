"""Export the current whole project; never edit original source or frozen results."""
from pathlib import Path
import hashlib,json,os,re,zipfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'Agent评测与故障归因系统_完整项目_2026-11-15.zip'
SKIP={'node_modules','.git','.gitnexus','.next','.pglite-data','.agent-tracing',
      '.conductor','.cache','.pnpm-store','pnpm-store','npm-cache','conda-cache',
      'gitnexus-home','__pycache__','.venv','venv','.turbo','.vercel',
      'postgres-portable','pglite-startup-data','pgdata','postgres-data'}
PATTERNS={
 'api_key':r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{28,}\b',
 'github_token':r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
 'aws_access_id':r'\bAKIA[A-Z0-9]{16}\b',
 'google_api_key':r'\bAIza[A-Za-z0-9_-]{35}\b',
 'private_key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
}

def digest(data):return hashlib.sha256(data).hexdigest()

def main():
 entries={};excluded=[];redacted=[];fixtures=[];manifest=[];recovered={}
 for directory,dirs,files in os.walk(ROOT,followlinks=False):
  parent=Path(directory)
  for name in dirs[:]:
   child=parent/name
   if name in SKIP or child.is_symlink() or child.is_junction():
    dirs.remove(name);excluded.append({'path':child.relative_to(ROOT).as_posix()+'/', 'reason':'installed dependency, generated cache/database/runtime or filesystem link'})
  for name in sorted(files):
   p=parent/name;rel=p.relative_to(ROOT).as_posix();lower=name.lower()
   reason=None
   if p==OUT or (parent==HERE and name!='package_full.py'):reason='delivery output generated separately'
   elif lower.endswith(('.zip','.7z','.tar','.gz','.conda')):reason='old archive/dependency distribution; extracted project material retained'
   elif lower.startswith('.env') or lower.endswith('.env') or lower in {'.npmrc','.yarnrc.yml','.mcp.json','vertex-ai-key.json','.pgpass'}:reason='local credentials/configuration; safe template supplied'
   elif p.suffix.lower() in {'.pem','.key','.p12','.pfx','.db','.sqlite','.sqlite3','.pyc','.tsbuildinfo'}:reason='private key/database or generated cache'
   elif '/docker-compose/dev/data/' in '/'+rel or '/scripts/clerk-to-betterauth/prod/' in '/'+rel or '/scripts/clerk-to-betterauth/test/' in '/'+rel:reason='deployment/account runtime data'
   elif rel.endswith('docker-compose/production/grafana/init_data.json'):reason='private deployment signing material'
   elif p.is_symlink():reason='filesystem link'
   if reason:excluded.append({'path':rel,'reason':reason});continue
   entries[rel]=p
 print(json.dumps({'stage':'inventory','files':len(entries),'excluded':len(excluded)}),flush=True)
 # Restore all 18 desktop assets previously recovered from the original archive.
 old=ROOT/'Agent评测系统_完整项目源码_2026-11-09.zip'
 if old.exists():
  with zipfile.ZipFile(old) as z:
   for name in z.namelist():
    rel=name.removeprefix('agent-eval-project/')
    if '/apps/desktop/build/' in '/'+rel and Path(rel).suffix.lower() in {'.png','.ico','.icns','.bmp','.plist'} and rel not in entries:
     recovered[rel]=z.read(name)
 overrides={}
 for index,(rel,p) in enumerate(entries.items()):
  if index%1000==0:print(json.dumps({'stage':'scan_progress','completed':index,'path':rel}),flush=True)
  data=p.read_bytes()
  try:body=data.decode('utf-8-sig')
  except UnicodeDecodeError:continue
  original=body
  for kind,pattern in PATTERNS.items():
   matches=list(re.finditer(pattern,body,re.S))
   if not matches:continue
   is_test='/__tests__/' in '/'+rel or '.test.' in rel or Path(rel).name.startswith('test_')
   # Retain only obvious fake fixture literals. Any other secret-like value is
   # replaced in export bytes, with path/hash recorded; workspace stays untouched.
   for match in reversed(matches):
    val=match.group()
    fake=is_test and any(s in val.lower() for s in ['dummy','example','mock','test'])
    if kind=='private_key':fake=fake and len(val)<160
    if fake:fixtures.append({'path':rel,'kind':kind});continue
    body=body[:match.start()]+'[REDACTED_'+kind.upper()+']'+body[match.end():]
    redacted.append({'path':rel,'kind':kind,'originalSha256':digest(data),'scope':'export only'})
  # Logs occasionally include local authorization headers; never export a bearer token.
  safe=re.sub(r'(?i)(authorization[\"\x27]?\s*[:=]\s*[\"\x27]?Bearer\s+)[A-Za-z0-9_./+\-=]{20,}',r'\1[REDACTED]',body)
  if safe!=body:redacted.append({'path':rel,'kind':'authorization_header','originalSha256':digest(data),'scope':'export only'})
  body=safe
  if body!=original:overrides[rel]=body.encode('utf-8')
 generated={}
 generated['00_完整项目入口与说明.md']='''# 完整项目交付 · 2026-11-15

这是当前 Agent 评测与故障归因项目的完整源码与研究材料，不是增量补丁。

- **当前实际平台工作副本**：`local_checks/2026-11-08_platform_audit/platform/`。包含完整 src、packages、apps、测试、静态资源、pnpm 锁文件及本机使用的 stubs。
- **已接入的 Python 规则诊断**：上述平台内 `scripts/eval-attribution/`；服务入口在 `src/server/services/agentEvalAttribution/`。
- **System VNext 与分层审核**：`local_checks/2026-11-14_system_vnext/`。
- **真实 PostgreSQL 联调、40 例数据与 Provider 接入**：`local_checks/2026-11-14_real_acceptance/`。
- **最新真实模型 Smoke 与代码**：`local_checks/2026-11-14_real_model_validation_v2/README.md`、`RESULTS.md`。包含前序失败回放、版本化 Prompt、6 次真实请求记录与离线分析；不是 40 例正式模型验收。
- **历轮修复、测试、回滚及研究记录**：`local_checks/` 下各日期目录。历史快照仍是历史材料，不应直接覆盖当前平台。
- **历史参考**：`source-reference/`。
- **学习包**：浏览器打开 `study_pack/index.html`；旧书籍版在 `docs/book/index.html`。

## 使用边界

Shadow 继续默认关闭。没有为了打包开启模型调用或运行实验。最新研究没有证明 LLM 相对增强规则的独有增量，不应据此默认推广。项目原 README 是早期学习工程说明，最新状态以上述报告为准。

这是完整源码包，不是可免安装启动的运行环境。node_modules、包管理器缓存、构建缓存、本机数据库、便携 PostgreSQL 二进制以及实际密钥配置未携带。换电脑须安装 Node/pnpm/Python 与 PostgreSQL 并填写配置；本机曾使用私有 SDK stubs，保留这些代码并不保证所有电脑安装成功。启动与演示步骤从 `local_checks/2026-11-08_phase2/DEMO.md` 和真实联调报告阅读。部分历史脚本有原电脑绝对路径，需要按新位置配置。

原有源码、测试、配置声明、锁文件、研究数据及可读实验记录均保留；原始 ZIP 不重复嵌套打包，冻结解压材料保留。排除清单见 `DELIVERY_EXCLUSIONS.json`。疑似凭据仅对导出副本脱敏，不修改原文件，详情见 `DELIVERY_SANITIZATIONS.json`。

`DELIVERY_MANIFEST.json` 为逐文件 SHA256 和字节数。包内 `verify_delivery.py` 可离线验证解压完整性：在本目录运行 `python verify_delivery.py`。打包只检查完整性，没有重新跑整个平台回归，也未声称换电脑运行环境已通过。
'''.encode('utf-8')
 app='local_checks/2026-11-08_platform_audit/platform/'
 generated[app+'.env.example']=b'''# Set your own local secrets. No live credential is included.
APP_URL=http://127.0.0.1:13010
NEXT_PUBLIC_APP_URL=http://127.0.0.1:13010
DATABASE_DRIVER=node
DATABASE_URL=postgresql://postgres@127.0.0.1:15433/agent_eval
AUTH_SECRET=REPLACE_WITH_LOCAL_RANDOM_SECRET
KEY_VAULTS_SECRET=REPLACE_WITH_32_BYTE_BASE64_SECRET
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
'''
 generated['verify_delivery.py']=b'''from pathlib import Path
import hashlib,json
b=Path(__file__).resolve().parent
m=json.loads((b/'DELIVERY_MANIFEST.json').read_text(encoding='utf-8'))
for x in m['files']:
 p=b/x['path']
 assert p.is_file(),x['path']
 data=p.read_bytes()
 assert len(data)==x['bytes'] and hashlib.sha256(data).hexdigest()==x['sha256'],x['path']
print('VERIFIED',len(m['files']),'files; no network or API calls')
'''
 generated['DELIVERY_EXCLUSIONS.json']=json.dumps(excluded,ensure_ascii=False,indent=2).encode('utf-8')
 generated['DELIVERY_SANITIZATIONS.json']=json.dumps({'exportOnly':redacted,'explicitFakeFixtureMarkersRetained':fixtures,'workspaceFilesModified':False},ensure_ascii=False,indent=2).encode('utf-8')
 for rel in generated:entries.pop(rel,None)
 print(json.dumps({'stage':'scanned','redactedFiles':len(overrides),'restoredAssets':len(recovered)}),flush=True)
 with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
  for rel in sorted(set(entries)|set(recovered)|set(generated)):
   if rel in generated:data=generated[rel];origin='delivery note/template'
   elif rel in recovered:data=recovered[rel];origin='original desktop asset restored'
   else:data=overrides.get(rel)
   if rel not in generated and rel not in recovered:
    if data is None:data=entries[rel].read_bytes()
    origin='export redacted copy' if rel in overrides else 'current workspace'
   z.writestr('agent-eval-project/'+rel,data)
   manifest.append({'path':rel,'bytes':len(data),'sha256':digest(data),'source':origin})
  record={'date':'2026-11-15','kind':'full current project source and experiment material','platformDirectory':app,'shadowDefaultChanged':False,'paidCalls':0,'files':manifest}
  z.writestr('agent-eval-project/DELIVERY_MANIFEST.json',json.dumps(record,ensure_ascii=False,indent=2))
 print(json.dumps({'stage':'archive_written','files':len(manifest)+1,'bytes':OUT.stat().st_size}),flush=True)
 with zipfile.ZipFile(OUT) as z:
  assert z.testzip() is None
  for x in manifest:assert digest(z.read('agent-eval-project/'+x['path']))==x['sha256'],x['path']
  for required in [app+'package.json',app+'pnpm-lock.yaml',app+'src/server/services/agentEvalAttribution/semanticShadow.ts','local_checks/2026-11-14_real_model_validation_v2/RESULTS.md','study_pack/index.html']:
   if required.endswith('semanticShadow.ts'):
    assert any(x['path'].startswith(app+'src/server/services/agentEvalAttribution/') for x in manifest)
   else:assert 'agent-eval-project/'+required in z.namelist(),required
 receipt={'archive':str(OUT),'archiveBytes':OUT.stat().st_size,'archiveSha256':digest(OUT.read_bytes()),'files':len(manifest)+1,'platformFiles':sum(x['path'].startswith(app) for x in manifest),'uncompressedBytes':sum(x['bytes'] for x in manifest),'allEntryHashesVerified':True,'crcVerified':True,'exportRedactedFiles':len(overrides),'noNewModelCalls':True}
 (HERE/'RECEIPT.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(receipt,ensure_ascii=True),flush=True)

if __name__=='__main__':main()

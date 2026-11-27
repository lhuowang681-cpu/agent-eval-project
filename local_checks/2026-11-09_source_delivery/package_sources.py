"""Deliver exact current modified/new source files and an isolated experimental candidate."""
from pathlib import Path
import difflib,hashlib,json,subprocess,zipfile

base=Path(__file__).resolve().parent
project=base.parents[1]
app=base.parent/'2026-11-08_platform_audit/platform'
round1=base.parent/'2026-11-08_round1'
phase2=base.parent/'2026-11-08_phase2'
phase3=base.parent/'2026-11-08_phase3'
dest=base/'modified_sources'
dest.mkdir(parents=True,exist_ok=True)
def load(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(value):return hashlib.sha256(value).hexdigest()
def put(relative,value):
 target=dest/relative
 assert target.resolve().is_relative_to(dest.resolve())
 target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(value)

# Phase2 manifests take precedence for files changed in both applied rounds.
latest={item['path']:item for item in load(round1/'source-integrity.json')['changedPlatformFiles']}
latest.update({item['path']:item for item in load(phase2/'SOURCE_CHANGES.json')['changedFiles']})
for relative,item in latest.items():
 assert sha((app/relative).read_bytes())==item['sha256'],'Current file differs from accepted source: '+relative
restore=load(phase3/'RESTORE_RECEIPT.json')
assert all(sha((app/item['path']).read_bytes())==item['sha256'] for item in restore['files'])

reference=load(project/'SOURCE_MANIFEST.json')
archive_path=Path(reference['source_archive'])
prefix='somethingelse-main-main/somethingelse-main/codinganalysis/lobehub/'
patch=[];records=[];originals={}
with zipfile.ZipFile(archive_path) as archive:
 names=set(archive.namelist())
 for relative in sorted(latest):
  assert not Path(relative).name.lower().startswith('.env')
  actual=(app/relative).read_bytes()
  before=archive.read(prefix+relative) if prefix+relative in names else b''
  originals[relative]=before
  kind='modified' if prefix+relative in names else 'added'
  lines=difflib.unified_diff(before.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True),actual.decode('utf-8-sig').replace('\r\n','\n').splitlines(keepends=True),fromfile='a/'+relative if kind=='modified' else '/dev/null',tofile='b/'+relative)
  for line in lines:patch.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
  put('platform/'+relative,actual)
  records.append({'path':'platform/'+relative,'relativeToPlatform':relative,'kind':kind,'sha256':sha(actual),'baselineSha256':sha(before) if kind=='modified' else None})
put('patches/current_vs_original.patch',''.join(patch).encode('utf-8'))

standalone=[]
for name in ['structured_jsonl_attribution.py','test_attribution.py']:
 data=(round1/'attribution'/name).read_bytes()
 put('standalone_attribution/'+name,data)
 standalone.append({'path':'standalone_attribution/'+name,'sha256':sha(data)})

# Retain the research candidate in a separate tree; it is never the active source.
candidate=[]
for item in load(phase3/'SOURCE_CHANGES.json')['changedFiles']:
 data=(phase3/'optimized'/Path(item['path']).name).read_bytes()
 assert sha(data)==item['sha256']
 relative='experimental_not_enabled/platform/'+item['path']
 put(relative,data);candidate.append({'path':relative,'sha256':sha(data)})
put('experimental_not_enabled/DO_NOT_APPLY.md',
 '第三轮研究候选，未推广。独立合成集未见完整审核提升，并发现有效短引文兼容退步；当前平台已恢复第二阶段默认审核。此目录仅供查看实验改动，不要覆盖到正常工程。\n'.encode('utf-8'))
put('patches/phase3_candidate_not_enabled.patch',(phase3/'platform-phase3.patch').read_bytes())

# Check the cumulative applied patch using pristine source entries only.
fixture=base/'patch_verification';fixture.mkdir(exist_ok=True)
for item in records:
 target=fixture/item['relativeToPlatform'];assert target.resolve().is_relative_to(fixture.resolve())
 if item['kind']=='added':
  if target.exists():target.unlink()
 else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(originals[item['relativeToPlatform']])
events=[]
for flags in [['--check'],[]]:
 command=['git','apply','--ignore-space-change',*flags,str(dest/'patches/current_vs_original.patch')]
 result=subprocess.run(command,cwd=fixture,capture_output=True,text=True)
 events.append({'command':command,'exitCode':result.returncode,'output':result.stdout+result.stderr})
 if result.returncode:break
matches=[]
if len(events)==2 and all(x['exitCode']==0 for x in events):
 for item in records:
  relative=item['relativeToPlatform']
  matches.append({'path':relative,'matches':(fixture/relative).read_text(encoding='utf-8-sig')==(app/relative).read_text(encoding='utf-8-sig')})
passed=len(matches)==len(records) and all(x['matches'] for x in matches)
assert passed,events
put('PATCH_VERIFICATION.json',json.dumps({'passed':passed,'events':events,'files':matches,'comparison':'UTF-8 text with normalized newlines; ZIP source files retain exact current bytes.'},ensure_ascii=False,indent=2).encode('utf-8'))

readme=f'''# 修改后的源码（2026-11-09）

这是实际修改/新增源码包，不是学习包的精简或脱敏副本。包含第一轮与第二阶段已应用的合并结果，保留平台相对目录及对应回归测试。

- platform/：当前实际使用的 {len(records)} 个修改/新增文件。覆盖到原平台根目录对应位置；原工程其余源码仍需保留。
- standalone_attribution/：第一轮独立JSONL归因修复入口和回归测试（2文件）。平台固定Python桥接则在platform/scripts/eval-attribution/。
- patches/current_vs_original.patch：上述平台文件相对最初原平台的累计补丁。覆盖文件和应用补丁二选一，不要重复应用。当前本机工作副本已经包含这些改动。
- experimental_not_enabled/：第三轮四文件候选，仅供研究，**没有推广**，不要混入当前platform目录。
- SOURCE_MANIFEST.json、PATCH_VERIFICATION.json：逐文件SHA及累计补丁隔离检查/应用结果。

这是改动源码增量包，不含原工程未修改文件、node_modules、.env、数据库、模型权重、真实密钥或完整运行环境；不能只解压此包就启动全平台。

已在原始文件组成的隔离副本实际检查并应用累计补丁，逐文件比对通过。本次仅整理交付，未重新运行945项平台回归。历史验收与真实模型/生产验证的局限仍以阶段报告为准。

如果使用补丁，在原始版本平台根目录先运行git apply --check --ignore-space-change 补丁绝对路径，检查通过再运行git apply --ignore-space-change 补丁绝对路径。不要对已经应用第一轮或第二阶段改动的工程直接套累计补丁。
'''
put('README_先看这里.md',readme.encode('utf-8'))
manifest={'date':'2026-11-09','activeVersion':'Phase1 + Phase2; Phase3 candidate restored/not promoted','platformFiles':records,'standaloneFiles':standalone,'experimentalNotEnabled':candidate,'platformCurrentHashesMatchAcceptanceRecords':True,'originalArchiveHashAsRecorded':reference['source_archive_sha256'],'patchVerificationPassed':passed}
put('SOURCE_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf-8'))

output=project/'Agent评测平台_修改源码_2026-11-09.zip'
files=[path for path in dest.rglob('*') if path.is_file()]
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for path in files:z.write(path,'agent-eval_modified_sources/'+path.relative_to(dest).as_posix())
with zipfile.ZipFile(output) as z:
 assert z.testzip() is None
 for path in files:assert z.read('agent-eval_modified_sources/'+path.relative_to(dest).as_posix())==path.read_bytes()
receipt={'archive':str(output),'bytes':output.stat().st_size,'sha256':sha(output.read_bytes()),'platformFiles':len(records),'standaloneFiles':len(standalone),'experimentalFilesNotEnabled':len(candidate),'zipEntries':len(files),'allSourceBytesVerified':True,'cumulativePatchPassed':passed}
(base/'DELIVERY.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=True))

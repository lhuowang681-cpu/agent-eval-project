"""Package reproducible offline research, not dependencies, private real data or DB."""
from pathlib import Path
import hashlib,json,os,zipfile
base=Path(__file__).resolve().parent
project=base.parents[1]
skip={'__pycache__','patch-verification','baseline-layout','node_modules','.gitnexus'}
entries=[]
for folder,dirs,files in os.walk(base,followlinks=False):
 parent=Path(folder)
 dirs[:]=[name for name in dirs if name not in skip and not (parent/name).is_symlink() and not (parent/name).is_junction()]
 for name in files:
  path=parent/name
  if path.suffix in {'.pyc','.zip','.tsbuildinfo'} or name=='DELIVERY_INTEGRITY.json':continue
  entries.append((path,'phase3/'+path.relative_to(base).as_posix()))
manifest=[{'path':name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path,name in entries]
archive=project/'第三轮归因质量评估与实验材料_2026-11-08.zip'
intro='''# 第三轮研究材料\n\n先读 [归因质量报告](phase3/ATTRIBUTION_QUALITY_REPORT.md)，再看 [五组结果](phase3/ABLATION_RESULTS.md)、[误拒分类](phase3/ERROR_TAXONOMY.md) 和 [复现步骤](phase3/REPRODUCE.md)。\n\n候选没有通过质量推广验收，默认平台已恢复原版。此包保留负结果，不是模型效果证明。\n\nphase3内的离线实验只需Python标准库。包含合成数据/保存的本机合成运行，不含历史真实XLSX、真实用户原文、模型密钥、数据库或node_modules。private是合成oracle隔离目录，不是生产隐私数据。\n\n完整平台集成、原始资料审计依赖已有项目；本ZIP不是全平台安装包。源码绝对路径链接换电脑需调整，本文相对报告链接可直接使用。\n'''
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for path,name in entries:z.write(path,name)
 z.writestr('START_HERE.md',intro)
 z.writestr('MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for item in manifest:assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256'],item['path']
record={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'entries':len(entries)+2,'allEntryHashesVerified':True,'candidatePromoted':False,'realModelEffectMeasured':False,'includesRealHistoricalXlsx':False,'includesDatabaseOrDependencies':False}
(base/'DELIVERY_INTEGRITY.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=True))

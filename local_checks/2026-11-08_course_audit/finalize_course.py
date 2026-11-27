from pathlib import Path
import hashlib,json,os,zipfile
base=Path(__file__).resolve().parent
root=base.parents[1]
pack=root/'study_pack'
review=(base/'COURSE_REVIEW.md').read_text(encoding='utf-8')
(pack/'audit/COURSE_REVIEW.md').write_text(review,encoding='utf-8')
checks=json.loads((pack/'PACK_CHECK.json').read_text(encoding='utf-8'))
assert checks['passed'] and checks['teachingStarted'] is False and checks['businessCodeModified'] is False
progress=json.loads((pack/'LEARNING_PROGRESS.json').read_text(encoding='utf-8'))
assert all(x['status']=='未开始' for x in progress['units'])
reader=json.loads((pack/'audit/READER_CHECK.json').read_text(encoding='utf-8'))
assert reader['passed'] and reader['externalRequests']==[]
files=[]
for folder,dirs,names in os.walk(pack,followlinks=False):
 parent=Path(folder)
 dirs[:]=[x for x in dirs if not x.startswith('.') and x not in {'node_modules','__pycache__'} and not (parent/x).is_junction() and not (parent/x).is_symlink()]
 for name in names:
  path=parent/name
  if name=='DELIVERY_MANIFEST.json':continue
  assert not name.lower().startswith('.env') and path.suffix.lower() not in {'.key','.pem','.pyc','.zip','.xlsx','.log'}
  files.append({'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
manifest={'courseVersion':'2026-11-08','modules':8,'units':10,'teachingStarted':False,'sourceCopies':33,'sourceAnchors':40,'files':files}
(pack/'DELIVERY_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=root/'study_pack.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for item in files:z.write(root/item['path'],item['path'])
 z.write(pack/'DELIVERY_MANIFEST.json','study_pack/DELIVERY_MANIFEST.json')
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for item in files:assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256']
receipt={'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'entries':len(files)+1,'allEntryHashesVerified':True,'modules':8,'units':10,'sourceCopies':33,'sourceAnchors':40,'requiredDocumentsComplete':True,'teachingStarted':False,'businessCodeChanged':False,'oldCourseDirectory':'deliverables/study_pack_before_2026-11-08','oldCourseZip':'deliverables/study_pack_before_2026-11-08.zip'}
(base/'STUDY_PACK_DELIVERY.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt,ensure_ascii=True))

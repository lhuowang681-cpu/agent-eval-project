import hashlib,json,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
B=Path(__file__).resolve().parent
def main():
 receipt=[]
 with tempfile.TemporaryDirectory(prefix='real-acceptance-portable-',dir=B.parent) as temp:
  root=Path(temp).resolve();assert root.parent==B.parent.resolve()
  target=root/'real-acceptance'
  def ignore(directory,names):return [n for n in names if n=='__pycache__' or n.endswith('.zip') or n=='FINAL_MANIFEST.json' and Path(directory).resolve()==B]
  shutil.copytree(B,target,ignore=ignore)
  original=json.loads((target/'results/quality.json').read_text(encoding='utf-8'))
  (target/'results/quality.json').rename(target/'results/quality.original.json')
  for command in [['test_quality.py'],['quality.py'],['review_probes.py'],['verify_delivery.py']]:
   p=subprocess.run([sys.executable,'-B',*command],cwd=target,capture_output=True,timeout=60);receipt.append({'command':['python','-B',*command],'exitCode':p.returncode})
   assert p.returncode==0,p.stderr.decode(errors='replace')[:1200]
  repeated=json.loads((target/'results/quality.json').read_text(encoding='utf-8'));assert repeated['summary']==original['summary']
  for a,b in zip(repeated['records'],original['records']):assert a['review']==b['review']
 (B/'results/portable.json').write_text(json.dumps({'checks':receipt,'sameMetricsAndVerdicts':True,'databaseRequiredForPythonReplay':False,'paidRequests':0},indent=2),encoding='utf-8')
 checked=subprocess.run([sys.executable,'-B','verify_delivery.py'],cwd=B,capture_output=True,timeout=30);assert checked.returncode==0,checked.stderr
 (B/'results/delivery-verification.json').write_bytes(checked.stdout)
 files=sorted(p for p in B.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p!=B/'FINAL_MANIFEST.json' and p.suffix!='.zip')
 manifest=B/'FINAL_MANIFEST.json';manifest.write_text(json.dumps({'stage':'final_delivery_not_pretest_freeze','files':{p.relative_to(B).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}},ensure_ascii=False,indent=2),encoding='utf-8')
 archive=B.parent/'System_VNext_Real_Acceptance_2026-11-14.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in files+[manifest]:z.write(p,'real-acceptance/'+p.relative_to(B).as_posix())
 with zipfile.ZipFile(archive) as z:assert z.testzip() is None
 print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'portableChecks':len(receipt)},ensure_ascii=True))
if __name__=='__main__':main()

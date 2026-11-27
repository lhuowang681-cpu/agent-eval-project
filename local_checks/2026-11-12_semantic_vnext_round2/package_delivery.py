"""Confined portable offline replay, then immutable delivery ZIP."""
import hashlib,json,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
BASE=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 receipt=[]
 with tempfile.TemporaryDirectory(prefix='semantic-round2-portable-',dir=BASE.parent) as temporary:
  # Verify cleanup target is a generated tree confined to this workspace.
  root=Path(temporary).resolve();assert root.parent==BASE.parent.resolve()
  target=root/'semantic-vnext-round2'
  def ignored(directory,names):
   return [name for name in names if name=='__pycache__' or name.endswith('.zip') or name=='FINAL_MANIFEST.json' and Path(directory).resolve()==BASE.resolve()]
  shutil.copytree(BASE,target,ignore=ignored)
  saved=json.loads((target/'results/case-results.json').read_text(encoding='utf-8'))
  (target/'results/case-results.json').rename(target/'results/original-case-results.json')
  commands=[['-m','unittest','test_round2','test_metrics'],['reproduce.py'],['legacy_comparison.py'],['run_experiment.py'],['analyze_results.py'],['verify_delivery.py']]
  for command in commands:
   p=subprocess.run([sys.executable,'-B',*command],cwd=target,capture_output=True,timeout=60)
   receipt.append({'command':['python','-B',*command],'exitCode':p.returncode})
   if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace')[:1200])
  rerun=json.loads((target/'results/case-results.json').read_text(encoding='utf-8'));assert rerun['summary']==saved['summary']
  for a,b in zip(rerun['records'],saved['records']):
   for field in ['review','baselineReview','oldReview']:assert a[field]==b[field]
  p=subprocess.run([sys.executable,'-B','review_cli.py'],cwd=target,input=(target/'data/cases.jsonl').read_bytes().splitlines()[0],capture_output=True,timeout=10)
  assert p.returncode==0 and json.loads(p.stdout)['decision']=='supported'
  receipt.append({'command':['python','-B','review_cli.py'],'exitCode':0})
 (BASE/'results/portable-verification.json').write_text(json.dumps({'checks':receipt,'sameMetricsAndVerdicts':True,'externalCalls':0,'platformRequired':False},indent=2),encoding='utf-8')
 p=subprocess.run([sys.executable,'-B','verify_delivery.py'],cwd=BASE,capture_output=True,timeout=10);assert p.returncode==0,p.stderr
 (BASE/'results/delivery-verification.json').write_text(p.stdout.decode(),encoding='utf-8')
 files=sorted(p for p in BASE.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='FINAL_MANIFEST.json' and p.suffix!='.zip')
 final=BASE/'FINAL_MANIFEST.json';final.write_text(json.dumps({'stage':'final_delivery_not_pretend_pretest_freeze','files':{p.relative_to(BASE).as_posix():sha(p) for p in files}},ensure_ascii=False,indent=2),encoding='utf-8')
 archive=BASE.parent/'Semantic_VNext_Round2_2026-11-12.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in files+[final]:z.write(p,'semantic-vnext-round2/'+p.relative_to(BASE).as_posix())
 with zipfile.ZipFile(archive) as z:assert z.testzip() is None
 print(json.dumps({'archive':str(archive),'files':len(files)+1,'bytes':archive.stat().st_size,'sha256':sha(archive),'portableChecks':len(receipt),'newExternalCalls':0},ensure_ascii=True))
if __name__=='__main__':main()

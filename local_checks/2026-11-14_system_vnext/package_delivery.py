from pathlib import Path
import hashlib,json,shutil,subprocess,sys,tempfile,zipfile
B=Path(__file__).resolve().parent
def main():
 checks=[]
 with tempfile.TemporaryDirectory(prefix='system-vnext-portable-',dir=B.parent) as temporary:
  p=Path(temporary).resolve();assert p.parent==B.parent.resolve()
  target=p/'system-vnext'
  def ignored(directory,names):return [n for n in names if n=='__pycache__' or n.endswith('.zip') or n=='FINAL_MANIFEST.json' and Path(directory).resolve()==B]
  shutil.copytree(B,target,ignore=ignored)
  for command in [['-m','unittest','test_review','test_system'],['verify.py']]:
   r=subprocess.run([sys.executable,'-B',*command],cwd=target,capture_output=True,timeout=60);assert r.returncode==0,r.stderr;checks.append(command)
  r=subprocess.run([sys.executable,'-B','sidecar.py'],cwd=target,input=(target/'results/demo-input.json').read_bytes(),capture_output=True,timeout=20);assert r.returncode==0,r.stderr;assert json.loads(r.stdout)['semantic']['status']=='completed';checks.append(['sidecar.py'])
 (B/'results/portable.json').write_text(json.dumps({'checks':checks,'platformRequired':False,'externalCalls':0},indent=2),encoding='utf-8')
 r=subprocess.run([sys.executable,'-B','verify.py'],cwd=B,capture_output=True,timeout=20);assert r.returncode==0,r.stderr
 (B/'results/verification.json').write_bytes(r.stdout)
 files=sorted(p for p in B.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='FINAL_MANIFEST.json')
 # Preserve nested historical manifests; exclude only the new root manifest.
 files=sorted(p for p in B.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p!=B/'FINAL_MANIFEST.json')
 m=B/'FINAL_MANIFEST.json';m.write_text(json.dumps({'stage':'final_delivery','files':{p.relative_to(B).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}},ensure_ascii=False,indent=2),encoding='utf-8')
 archive=B.parent/'System_VNext_2026-11-14.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in files+[m]:z.write(p,'system-vnext/'+p.relative_to(B).as_posix())
 with zipfile.ZipFile(archive) as z:assert z.testzip() is None
 print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'portableChecks':3},ensure_ascii=True))
if __name__=='__main__':main()

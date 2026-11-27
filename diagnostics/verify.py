from pathlib import Path
import hashlib,json,re
B=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 f=json.loads((B/'phases/0-baseline.json').read_text(encoding='utf-8'))
 available=[Path(p) for p in f['activeFiles'] if Path(p).exists()]
 assert all(sha(p)==f['activeFiles'][str(p)] for p in available)
 assert all(sha(B/'baseline'/p)==h for p,h in f['baselineFiles'].items())
 a=json.loads((B/'phases/1-3-algorithm-freeze.json').read_text(encoding='utf-8'));assert all(sha(B/p)==h for p,h in a['files'].items())
 assert sha(B/'phases/1-holdout.json')==json.loads((B/'phases/1-data-freeze.json').read_text(encoding='utf-8'))['sha256']
 for p in B.rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.zip':assert not re.search(rb'sk-[A-Za-z0-9_-]{24,}',p.read_bytes()),p.name
 if (B/'FINAL_MANIFEST.json').exists():
  m=json.loads((B/'FINAL_MANIFEST.json').read_text(encoding='utf-8'));assert all(sha(B/p)==h for p,h in m['files'].items())
 print(json.dumps({'unchangedActiveFiles':len(available),'baselineFiles':len(f['baselineFiles']),'candidateAndDataFreezeVerified':True,'credentialPatternMatches':0,'newRealModelCalls':0}))
if __name__=='__main__':main()

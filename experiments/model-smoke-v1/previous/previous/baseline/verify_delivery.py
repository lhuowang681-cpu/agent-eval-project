"""Offline integrity verification; no external connections."""
import hashlib,json,re
from pathlib import Path
from freeze import hashes
BASE=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 frozen=json.loads((BASE/'ALGORITHM_FREEZE.json').read_text(encoding='utf-8'));assert frozen['files']==hashes()
 protocol=json.loads((BASE/'PROTOCOL_FREEZE.json').read_text(encoding='utf-8'));assert all(sha(BASE/p)==h for p,h in protocol['files'].items())
 snapshot=json.loads((BASE/'SOURCE_SNAPSHOT.json').read_text(encoding='utf-8'))
 assert all(sha(BASE/'previous'/p)==h for p,h in snapshot['previous'].items())
 platform=[Path(p) for p in snapshot['originalPlatform'] if Path(p).exists()]
 assert all(sha(p)==snapshot['originalPlatform'][str(p)] for p in platform)
 original=BASE.parent/'2026-11-10_semantic_vnext'
 if original.exists():assert all(sha(original/p)==h for p,h in snapshot['previous'].items())
 required=['IMPLEMENTATION_AUDIT','REVIEW_FIX_REPORT','BASELINE_COMPARISON','DATASET_PROTOCOL','EXPERIMENT_RESULTS','ABLATION_RESULTS','FAILURE_CASE_ANALYSIS','PROMOTION_DECISION','INTERVIEW_TECHNICAL_SUMMARY','README']
 assert all((BASE/(name+'.md')).is_file() for name in required)
 data=json.loads((BASE/'results/case-results.json').read_text(encoding='utf-8'))
 assert len(data['records'])==48 and data['externalCalls']==0
 assert data['summary']['previous_review']['falseSupport']==8 and data['summary']['D_SCRIPTED_reviewed']['falseSupport']==0
 assert data['summary']['D_SCRIPTED_reviewed']['falseGap']==data['summary']['previous_review']['falseGap']==8
 count=0
 for p in BASE.rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.zip':
   count+=1;assert not re.search(rb'sk-[A-Za-z0-9_-]{24,}',p.read_bytes()),'Potential credential: '+p.name
 manifest=BASE/'FINAL_MANIFEST.json'
 if manifest.exists():
  m=json.loads(manifest.read_text(encoding='utf-8'));assert all(sha(BASE/p)==h for p,h in m['files'].items())
 print(json.dumps({'candidateFreezeVerified':True,'protocolAndGoldUnchanged':True,'previousSnapshotFiles':len(snapshot['previous']),'availablePlatformFilesVerified':len(platform),'newModelCalls':0,'scannedFiles':count,'credentialPatternMatches':0,'note':'Pattern scan is not exhaustive privacy certification.'}))
if __name__=='__main__':main()

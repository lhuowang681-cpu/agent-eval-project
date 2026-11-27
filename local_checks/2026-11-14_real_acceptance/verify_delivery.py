"""Offline integrity and scope checks, never opens a DB or model connection."""
import hashlib,json,re
from pathlib import Path
B=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 baseline=json.loads((B/'BASELINE.json').read_text(encoding='utf-8'))
 available=[Path(p) for p in baseline['platform'] if Path(p).exists()]
 assert all(sha(p)==baseline['platform'][str(p)] for p in available)
 assert all(sha(B/'previous'/p)==h for p,h in baseline['previous'].items())
 original=B.parent/'2026-11-14_system_vnext'
 if original.exists():assert all(sha(original/p)==h for p,h in baseline['previous'].items())
 protocol=json.loads((B/'PROTOCOL_FREEZE.json').read_text(encoding='utf-8'));assert all(sha(B/p)==h for p,h in protocol['files'].items())
 required=['POSTGRES_E2E_REPORT','PROVIDER_AND_BUDGET','DATASET_PROTOCOL','BASELINE_SHADOW_COMPARISON','REVIEW_ERROR_ANALYSIS','REGRESSION_REPORT','PROMOTION_DECISION','README']
 assert all((B/(n+'.md')).stat().st_size>100 for n in required)
 pg=json.loads((B/'results/postgres-e2e.json').read_text(encoding='utf-8'));assert len(pg['records'])==11 and pg['checks']['scoreJudgeRunMessagesUnchanged'] and pg['checks']['shadowFailures']==1
 quality=json.loads((B/'results/quality.json').read_text(encoding='utf-8'));assert len(quality['records'])==40 and quality['newRealModelCalls']==0
 tests=json.loads((B/'results/regression.json').read_text(encoding='utf-8'));assert all(t['exitCode']==0 for t in tests)
 provider=json.loads((B/'results/provider-test.json').read_text(encoding='utf-8'));assert provider['tests']==10 and provider['realPaidRequests']==0
 count=0
 for p in B.rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.zip':
   count+=1;assert not re.search(rb'sk-[A-Za-z0-9_-]{24,}',p.read_bytes()),'Potential credential '+p.name
 if (B/'FINAL_MANIFEST.json').exists():
  manifest=json.loads((B/'FINAL_MANIFEST.json').read_text(encoding='utf-8'));assert all(sha(B/p)==h for p,h in manifest['files'].items())
 print(json.dumps({'platformFilesVerified':len(available),'previousFilesVerified':len(baseline['previous']),'protocolAndGoldUnchanged':True,'reportsPresent':len(required),'realDatabaseScenarios':11,'realPaidRequests':0,'credentialPatternMatches':0,'scannedFiles':count,'independence':'single author synthetic; not strict independent acceptance'}))
if __name__=='__main__':main()

"""One-time manifest writer; does not run the system under evaluation."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import sys
import validate_holdout as validator

HOME=Path(__file__).resolve().parent
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    target=HOME/'split-manifest.json'
    if target.exists():raise SystemExit('Already frozen; create a disclosed new version instead of overwriting.')
    cases=validator.load(HOME/'private'/'cases.jsonl');inputs=validator.load(HOME/'inputs.jsonl')
    count=validator.validate_data(cases,inputs)
    files=['inputs.jsonl','private/cases.jsonl','private/build_holdout.py','validate_holdout.py','test_validation.py','README.md','freeze_holdout.py']
    phase2=HOME.parents[1]/'2026-11-08_phase2'/'patch-verification'
    sources={
      'phase2/contracts.ts':phase2/'src/server/services/agentEvalAttribution/contracts.ts',
      'phase2/fixtures.ts':phase2/'src/server/services/agentEvalAttribution/__tests__/fixtures.ts',
      'original/taxonomy.py':HOME.parents[2]/'source-reference/attribution/taxonomy.py',
    }
    manifest=dict(schemaVersion=1,datasetVersion='independent-synthetic-holdout-v1',caseCount=count,
      split='holdout',usedForOptimization=False,origin='synthetic',oracle='single_author_manual_not_real_annotation',
      frozenAtUtc=datetime.now(timezone.utc).isoformat(),python=sys.version.split()[0],
      inputProjection='inputs.jsonl',oracleFile='private/cases.jsonl',
      caseIds=[case['id'] for case in cases],
      files={name:sha(HOME/name) for name in files},designSources={name:sha(path) for name,path in sources.items()},
      optimizationFreeze=dict(utc='2026-11-08T10:06:58.388469+00:00',decisionSha256='0098085e2a8b10112b37ee52a55ededfe5cf1bc0182df1612c3ec99f7e67f7a9',implementationRead=False),
      protocol='Optimization frozen before oracle reveal; one formal replay; no post-result algorithm/oracle changes')
    target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    commitment=sha(target)
    (HOME/'MANIFEST.sha256').write_text(commitment+'  split-manifest.json\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(cases=count,manifestSha256=commitment,inputsSha256=sha(HOME/'inputs.jsonl'),oracleSha256=sha(HOME/'private'/'cases.jsonl')),ensure_ascii=False))

if __name__=='__main__':main()

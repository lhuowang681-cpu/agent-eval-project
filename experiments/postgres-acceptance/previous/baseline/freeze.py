"""Immutable pre-evaluation algorithm freeze. Run before building test data."""
import datetime,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
def hashes():return {p.relative_to(BASE).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((BASE/'candidate').glob('*.py'))}
if __name__=='__main__':
 target=BASE/'ALGORITHM_FREEZE.json'
 if target.exists():raise SystemExit('Already frozen; refuse overwrite')
 target.write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':hashes(),'formalDatasetExists':(BASE/'data/cases.jsonl').exists(),'independentAuthor':False,'noUnseenGeneralizationClaim':True},indent=2),encoding='utf-8')
 print('Candidate frozen before formal dataset creation')

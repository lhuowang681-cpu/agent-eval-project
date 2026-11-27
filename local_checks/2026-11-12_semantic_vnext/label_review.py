"""Pre-evaluation label adjudication; preserve original dataset bytes."""
import datetime,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
if __name__=='__main__':
 target=BASE/'data/LABEL_REVIEW.json'
 if target.exists():raise SystemExit('Review already frozen')
 if (BASE/'results/case-results.json').exists():raise SystemExit('Formal evaluation already exists')
 rows=[json.loads(s) for s in (BASE/'data/cases.jsonl').read_text(encoding='utf-8').splitlines()]
 # The initial 'supportable' conflated human evidence sufficiency with what the
 # limited JSON verifier implements. Human-valid NL cases must count as gaps.
 ids=['case-10','case-11','case-15','case-16','case-17','case-19','case-20','case-48']
 corrections=[{'id':ident,'goldIndex':0,'supportable':True,'automaticProofImplemented':False,'reason':'Human-readable cited facts support the authored observation, but the current JSON verifier cannot verify this NL/mapping/unit relation. Count rejection as a real evidence gap, do not hide it.'} for ident in ids]
 assert all(next(r for r in rows if r['id']==c['id'])['gold'][0]['truth']=='correct' for c in corrections)
 target.write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'beforeFormalEvaluation':True,'sameAuthor':True,'originalDatasetSha256':hashlib.sha256((BASE/'data/cases.jsonl').read_bytes()).hexdigest(),'corrections':corrections},indent=2),encoding='utf-8')
 print('Pre-evaluation human-vs-automatic label distinction frozen; original bytes unchanged')

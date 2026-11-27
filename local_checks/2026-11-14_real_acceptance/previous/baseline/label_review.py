import datetime,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
if __name__=='__main__':
 target=BASE/'data/LABEL_REVIEW.json'
 if target.exists() or (BASE/'results/case-results.json').exists():raise SystemExit('Refuse post-evaluation or repeated label changes')
 rows=[json.loads(s) for s in (BASE/'data/cases.jsonl').read_text(encoding='utf-8').splitlines()]
 ids=['case-10','case-11','case-15','case-16','case-17','case-19','case-20','case-48']
 corrections=[{'id':i,'goldIndex':0,'supportable':True,'automaticProofImplemented':False,'reason':'Human-readable citations support the authored observation; inability of the JSON verifier is a genuine rejection gap, not lack of evidence.'} for i in ids]
 assert all(next(r for r in rows if r['id']==c['id'])['gold'][0]['truth']=='correct' for c in corrections)
 target.write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'beforeFormalEvaluation':True,'sameAuthor':True,'originalDatasetSha256':hashlib.sha256((BASE/'data/cases.jsonl').read_bytes()).hexdigest(),'corrections':corrections},indent=2),encoding='utf-8')
 print('Pre-evaluation adjudication frozen; original data unchanged')

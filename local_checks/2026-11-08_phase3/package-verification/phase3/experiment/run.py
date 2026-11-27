"""Reproducible offline comparison; engines only receive inputs, never labels."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys,time
from metrics import summarize

base=Path(__file__).resolve().parents[1]


def run(dataset,label):
    cases=[json.loads(line) for line in dataset.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    if '--unreviewed-rule-support' in sys.argv:
        # Do not change the frozen oracle file. Eligibility alone is insufficient
        # to label the eventual rule output's citations. Later adjudication is separate.
        for row in cases:row['labels']['ruleCanonicalSupported']=None
    assert len({x['id'] for x in cases})==len(cases)
    inputs={'cases':[{k:row[k] for k in ['id','trajectory','candidate']} for row in cases]}
    target=base/'results'/label;target.mkdir(parents=True,exist_ok=True)
    receipts=[];summaries={}
    for engine in ['baseline','optimized']:
        manifest=json.loads((base/engine/'MANIFEST.json').read_text(encoding='utf-8'))
        for item in manifest['files']:
            assert hashlib.sha256((base/engine/item['snapshot']).read_bytes()).hexdigest()==item['sha256']
        command=[sys.executable,'-E','-s','-X','utf8',str(base/'experiment/engine_worker.py'),engine]
        start=time.perf_counter();result=subprocess.run(command,input=json.dumps(inputs),text=True,encoding='utf-8',capture_output=True,timeout=120)
        receipts.append({'command':command,'exitCode':result.returncode,'seconds':time.perf_counter()-start,'stderr':result.stderr})
        if result.returncode:
            (target/'failed-commands.json').write_text(json.dumps(receipts,indent=2),encoding='utf-8')
            raise RuntimeError(result.stderr)
        raw=json.loads(result.stdout)
        assert len(raw['records'])==len(cases)
        (target/(engine+'-outputs.json')).write_text(json.dumps(raw,ensure_ascii=False,indent=2),encoding='utf-8')
        summaries[engine]=summarize(cases,raw)
    report={'dataset':str(dataset),'datasetSha256':hashlib.sha256(dataset.read_bytes()).hexdigest(),'recordedAtUtc':datetime.now(timezone.utc).isoformat(),'cases':len(cases),'ruleSupportAwaitingOutputAdjudication':'--unreviewed-rule-support' in sys.argv,'candidateGeneration':'Offline controlled fixture replay, not LLM inference.','realModel':{'status':'blocked','reason':'No confirmed provider/model available for this experiment; no external model request.'},'commands':receipts,'engines':summaries}
    (target/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'split':label,'cases':len(cases),'baseline':summaries['baseline']['metrics']['full'],'optimized':summaries['optimized']['metrics']['full']},ensure_ascii=True))


if __name__=='__main__':
    dataset=Path(sys.argv[1]).resolve();label=sys.argv[2]
    assert label.replace('-','').isalnum(),'Safe result directory label required'
    run(dataset,label)

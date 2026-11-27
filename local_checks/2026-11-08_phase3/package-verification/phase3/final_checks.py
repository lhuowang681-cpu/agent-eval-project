from pathlib import Path
import csv,hashlib,json,re,subprocess,sys
base=Path(__file__).resolve().parent
checks=[]
def check(name,condition):
 checks.append({'name':name,'passed':bool(condition)})
 if not condition:raise AssertionError(name)
for filename in ['bridge-tasks.json','bridge-candidate.json']:
 data=json.loads((base/'regression'/filename).read_text(encoding='utf-8'))
 check(filename,data['success'] and data['numTotalTests']==data['numPassedTests']==71 and data['numFailedTests']==0)
for filename,count in [('python-current.log',36),('python-candidate-working-tree.log',36),('policy-after.log',8),('metrics.log',8)]:
 value=(base/'regression'/filename).read_text(encoding='utf-8')
 check(filename,bool(re.search(r'Ran '+str(count)+r' tests',value)) and value.rstrip().endswith('OK'))
before=(base/'regression/policy-before.log').read_text(encoding='utf-8')
check('development red evidence retained','Ran 8 tests' in before and 'FAILED (failures=6)' in before)
for split,count in [('development',12),('controlled',4),('holdout',28)]:
 comparison=json.loads((base/'results'/split/'comparison-adjudicated.json').read_text(encoding='utf-8'))
 check(split+' cases',comparison['cases']==count and comparison['engineRerun'] is False)
 for engine in ['baseline','optimized']:
  raw=json.loads((base/'results'/split/(engine+'-outputs.json')).read_text(encoding='utf-8'))
  check(split+' '+engine+' input/evaluation integrity',len({x['id'] for x in raw['records']})==count and raw['modelCalls']==0 and all(x['outcomes'][method]['executionError'] is None for x in raw['records'] for method in ['rules','direct','structured','citations','full']))
csv_rows=list(csv.DictReader((base/'CASE_RESULTS.csv').open(encoding='utf-8-sig',newline='')))
check('440 distinct per-case-method-version rows',len(csv_rows)==440 and len({(x['split'],x['engine'],x['id'],x['method']) for x in csv_rows})==440)
source=json.loads((base/'SOURCE_CHANGES.json').read_text(encoding='utf-8'))
check('candidate not promoted',source['candidatePromoted'] is False and source['currentSourceMatchesBaseline'] and source['optimizedSnapshotUnchanged'])
check('reversible patch and protected originals',source['patchAndRollbackVerified'] and source['originalReferences']==96 and source['originalReferencesUnchanged'])
for engine in ['baseline','optimized']:
 data=json.loads((base/engine/'MANIFEST.json').read_text(encoding='utf-8'))
 check(engine+' frozen hashes',all(hashlib.sha256((base/engine/item['snapshot']).read_bytes()).hexdigest()==item['sha256'] for item in data['files']))
decision=json.loads((base/'adjudication/DECISIONS.json').read_text(encoding='utf-8'))
check('output adjudication bound to inputs',decision['inputSha256']==hashlib.sha256((base/'adjudication/INPUT.json').read_bytes()).hexdigest())
holdout_before=(base/'holdout/split-manifest.json').read_bytes()
result=subprocess.run([sys.executable,'-B',str(base/'holdout/validate_holdout.py')],capture_output=True,text=True,encoding='utf-8')
check('holdout frozen structural/hash validation',result.returncode==0 and holdout_before==(base/'holdout/split-manifest.json').read_bytes())
link_checks=[]
for file in base.glob('*.md'):
 for target in re.findall(r'\]\((C:/[^)]+)\)',file.read_text(encoding='utf-8')):
  target=re.sub(r':\d+$','',target)
  link_checks.append({'file':file.name,'target':target,'exists':Path(target).is_file()})
check('top-level source links',all(x['exists'] for x in link_checks))
record={'checks':checks,'sourceLinks':link_checks,'passed':all(x['passed'] for x in checks),'holdoutValidation':{'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr},'meaning':'Artifact, regression and reproducibility checks only; negative quality results remain negative.'}
(base/'FINAL_CHECKS.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'checks':len(checks),'sourceLinks':len(link_checks),'passed':record['passed']}))

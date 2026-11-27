import collections,hashlib,json,pathlib,re
base=pathlib.Path(__file__).resolve().parent
project=base.parents[3]
current=project/'local_checks/2026-11-08_platform_audit/platform'
pattern=re.compile(r'^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$',re.M)
def parse(variant):
 text=(base/(variant+'.log')).read_text(encoding='utf-8')
 root=base/variant
 def normalize(s):
  return s.replace(str(root).replace('\\','/'),'<workspace>').replace(str(root),'<workspace>').replace('types/'+variant,'types/<workspace>').replace('types\\'+variant,'types\\<workspace>')
 diags=[{'file':m[1].replace('\\','/'),'line':int(m[2]),'column':int(m[3]),'code':m[4],'message':normalize(m[5])} for m in pattern.finditer(text)]
 files=[line for line in text.splitlines() if re.match(r'^[A-Za-z]:[/\\]',line) and re.search(r'\.(?:[cm]?tsx?|json)$',line) and ': error TS' not in line]
 leaks=[];workspace=[]
 for filename in files:
  actual=pathlib.Path(filename).resolve()
  try:
   rel=actual.relative_to(current)
   if not rel.parts or rel.parts[0]!='node_modules':leaks.append(str(actual))
  except ValueError:pass
  try:workspace.append(actual.relative_to(root).as_posix())
  except ValueError:pass
 result={'diagnostics':diags,'loadedFileCount':len(files),'loadedOwnWorkspaceFiles':sorted(set(workspace)),'originalWorkspaceSourceLeaks':sorted(set(leaks))}
 (base/(variant+'-parsed.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 return result
old=parse('baseline');new=parse('round1-snapshot')
def key(d):return(d['file'],d['line'],d['column'],d['code'],d['message'])
oldSet={key(d):d for d in old['diagnostics']};newSet={key(d):d for d in new['diagnostics']}
integrity=json.loads((project/'local_checks/2026-11-08_round1/source-integrity.json').read_text(encoding='utf-8'))
changed={x['path'] for x in integrity['changedPlatformFiles']}
byCode=dict(collections.Counter(d['code'] for d in new['diagnostics']).most_common())
byFile=dict(collections.Counter(d['file'] for d in new['diagnostics']).most_common())
baselineHashes=json.loads((base/'baseline-source-hashes.json').read_text(encoding='utf-8'))
snapshotHashes=json.loads((base/'snapshot-source-hashes.json').read_text(encoding='utf-8'))
hashFailures=[]
for folder,records in [('baseline',baselineHashes),('round1-snapshot',snapshotHashes)]:
 for row in records:
  if hashlib.sha256((base/folder/row['path']).read_bytes()).hexdigest()!=row['sha256']:hashFailures.append({'variant':folder,'path':row['path']})
commands={v:json.loads((base/(v+'-command.json')).read_text(encoding='utf-8')) for v in ['baseline','round1-snapshot']}
summary={'baselineDiagnostics':len(oldSet),'round1Diagnostics':len(newSet),'sharedDiagnostics':len(oldSet.keys()&newSet.keys()),'newInRound1':[newSet[k] for k in sorted(newSet.keys()-oldSet.keys())],'removedInRound1':[oldSet[k] for k in sorted(oldSet.keys()-newSet.keys())],'round1ChangedFileDiagnostics':[d for d in new['diagnostics'] if d['file'] in changed],'byCode':byCode,'byFile':byFile,'commandResults':commands,'actualLoadedWorkspaceLeaks':{'baseline':old['originalWorkspaceSourceLeaks'],'round1-snapshot':new['originalWorkspaceSourceLeaks']},'sourceHashVerificationFailures':hashFailures,'configsIdentical':commands['baseline']['tsconfigSha256']==commands['round1-snapshot']['tsconfigSha256']}
(base/'comparison.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k not in {'byCode','byFile'}},ensure_ascii=True)[:10000])

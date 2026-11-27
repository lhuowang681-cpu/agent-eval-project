import collections,json,pathlib,re
base=pathlib.Path(__file__).resolve().parent
project=base.parents[3]
log=project/'local_checks/2026-11-08_round1/logs/typecheck-final-8gb.log'
text=log.read_text(encoding='utf-8')
pattern=re.compile(r'^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$',re.M)
diags=[dict(file=m[1].replace('\\','/'),line=int(m[2]),column=int(m[3]),code=m[4],message=m[5]) for m in pattern.finditer(text)]
def counts(key):return dict(collections.Counter(key(d) for d in diags).most_common())
summary={'total':len(diags),'byCode':counts(lambda d:d['code']),'byDirectory':counts(lambda d:'/'.join(d['file'].split('/')[:3])),'byFile':counts(lambda d:d['file']),'keyChain':[d for d in diags if any(x.lower() in d['file'].lower() for x in ['agentEval','agentRuntime','agent-runtime','model-runtime','ModelRuntime','trace','eval-rubric','eval-dataset'])]}
(base/'round1-diagnostics.json').write_text(json.dumps(diags,ensure_ascii=False,indent=2),encoding='utf-8')
(base/'round1-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=True)[:11000])

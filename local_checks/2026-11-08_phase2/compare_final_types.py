from pathlib import Path
import collections, json, re

base=Path(__file__).resolve().parent
pattern=re.compile(r'^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$',re.M)
old=json.loads((base/'audit/types/baseline-parsed.json').read_text(encoding='utf-8'))['diagnostics']
current=[{'file':match[1].replace('\\','/'),'line':int(match[2]),'column':int(match[3]),'code':match[4],'message':match[5]} for match in pattern.finditer((base/'logs/final-typecheck.log').read_text(encoding='utf-8'))]
def key(item): return item['file'],item['code'],item['message']
remaining=collections.Counter(key(item) for item in old)
added=[]
for item in current:
 if remaining[key(item)]: remaining[key(item)]-=1
 else: added.append(item)
removed=[]
for item in old:
 if remaining[key(item)]: removed.append(item);remaining[key(item)]-=1
by_key=collections.defaultdict(list)
for item in old: by_key[key(item)].append(item)
relocated=[]
for item in current:
 if by_key[key(item)]:
  previous=by_key[key(item)].pop(0)
  if (item['line'],item['column'])!=(previous['line'],previous['column']): relocated.append({'file':item['file'],'code':item['code'],'oldLine':previous['line'],'newLine':item['line']})
result={'baselineCount':len(old),'finalCount':len(current),'added':added,'removed':removed,'relocated':relocated,'comparison':'Multiset of file + TS code + first diagnostic message; line/column shifts separately recorded. Original-versus-round1 exact comparison is in audit/types/comparison.json.','wholeRepositoryTypeCheckPassed':False,'finalExitCode':json.loads((base/'results/final-typecheck-command.json').read_text(encoding='utf-8'))['exitCode']}
(base/'TYPECHECK_FINAL_COMPARISON.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
raise SystemExit(0 if not added else 1)

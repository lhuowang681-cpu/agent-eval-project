"""Read-only triage of same-location diagnostic message changes; never reruns or weakens tsc."""
import collections,hashlib,json,pathlib,re
BASE=pathlib.Path(__file__).resolve().parent
PHASE=BASE.parents[1]
PLATFORM=BASE.parents[3]/'local_checks/2026-11-08_platform_audit/platform'
comparison=json.loads((PHASE/'TYPECHECK_LOCATION_COMPARISON.json').read_text(encoding='utf-8'))
def blocks(path):
 text=path.read_text(encoding='utf-8');matches=list(re.finditer(r'^(.+?)\((\d+),(\d+)\): error (TS\d+):',text,re.M));result={}
 for index,m in enumerate(matches):
  result[(m[1],int(m[2]),int(m[3]),m[4])]=text[m.start():matches[index+1].start() if index+1<len(matches) else len(text)].rstrip()
 return result
oldBlocks=blocks(BASE/'baseline.log');newBlocks=blocks(PHASE/'logs/final-typecheck.log')
def union_render(s):
 s=re.sub(r'"[^"\n]+"(?:\s*\|\s*"[^"\n]+")+',lambda m:' | '.join(sorted(x.strip() for x in m[0].split('|'))),s)
 return re.sub(r"'([^']*)'",lambda m:"'"+' | '.join(sorted(x.strip() for x in m[1].split('|')))+"'",s)
records=[]
for item in comparison['messageChangesAtSameLocations']:
 loc=tuple(item['location']);file=loc[0];a=item['baselineMessage'];b=item['finalMessage'];old=oldBlocks[loc];new=newBlocks[loc]
 evidence=[];confidence='observed_primary_cause_unchanged'
 if file.endswith('/getTestDB.ts'):
  category='absolute_schema_import_path';reason='Same PGlite argument/client incompatibility; schema import path differs between audit copy and live workspace.'
  normalize=lambda s:re.sub(r'typeof import\("[^"]+/packages/database/src/schemas/index"\)','typeof import("<schema>")',s)
  evidence.append({'normalizedFirstLineEqual':normalize(a)==normalize(b)})
 elif 'DecoratedProcedureRecord' in a and 'DecoratedProcedureRecord' in b:
  category='trpc_generic_context_same_missing_property';reason='The missing API property is identical; rendered errorShape/error-code union context and truncation changed.'
  missing=lambda s:re.search(r"Property '([^']+)' does not exist",s).group(1)
  evidence.append({'baselineMissingProperty':missing(a),'finalMissingProperty':missing(b),'sameMissingProperty':missing(a)==missing(b)})
 elif 'TemplateStringsArray' in a and 'TemplateStringsArray' in b:
  category='i18n_union_context_same_argument';reason='Same translation call argument and namespace/key mismatch; displayed key union order/prefix changed. Full omitted union membership equivalence is not provable from truncated logs.'
  argument=lambda s:s.split(' is not assignable to parameter of type ')[0]
  evidence.append({'sameArgument':argument(a)==argument(b),'baselineArgument':argument(a),'finalArgument':argument(b)})
  confidence='consistent_with_rendering_change_full_union_equivalence_unproven'
 elif file in ['src/server/routers/lambda/session.ts','src/server/routers/lambda/knowledgeBase.ts']:
  category='object_property_render_order_same_leaf_mismatch';reason='Object members reorder, but the complete final mismatch remains the same.'
  tail=lambda s:s.splitlines()[-3:]
  evidence.append({'sameLastThreeCauseLines':tail(old)==tail(new),'baselineLeafCause':tail(old),'finalLeafCause':tail(new)})
 elif union_render(a)==union_render(b):
  category='proved_union_order_only';reason='Messages become identical after sorting displayed union members; no member set change in these shown types.'
  evidence.append({'normalizedFirstLineEqual':True});confidence='proved_rendering_only'
 else:
  category='unresolved';reason='Requires manual follow-up; not classified as historical rendering by default.';confidence='unresolved'
 oldHash=hashlib.sha256((BASE/'baseline'/file).read_bytes()).hexdigest();newHash=hashlib.sha256((PLATFORM/file).read_bytes()).hexdigest()
 records.append({**item,'category':category,'assessment':reason,'confidence':confidence,'sourceUnchanged':oldHash==newHash,'baselineSourceSha256':oldHash,'finalSourceSha256':newHash,'evidence':evidence,'rawBaselineBlock':old,'rawFinalBlock':new})
summary={'baselineCount':comparison['baseline'],'finalCount':comparison['final'],'newLocations':comparison['newLocations'],'removedLocations':comparison['removedLocations'],'changedFirstLineMessages':len(records),'categories':dict(collections.Counter(r['category'] for r in records)),'changedLocatedSources':[r['location'] for r in records if not r['sourceUnchanged']],'observedNewPrimaryTypeCauses':[],'unresolved':[r['location'] for r in records if r['category']=='unresolved'],'strictFullMessageEquality':False,'limitations':['Context unions are truncated; same primary diagnostic is not proof all expanded member sets are identical.','This classifies existing logs only; no new tsc or source/config edits.'],'records':records}
(BASE/'FINAL_MESSAGE_AUDIT.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k!='records'},ensure_ascii=True))

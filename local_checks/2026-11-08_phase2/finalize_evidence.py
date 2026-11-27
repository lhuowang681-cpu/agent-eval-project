"""Collect distinct final assertions and verify the Phase2 patch on a separate fixture."""
from pathlib import Path
import hashlib, json, subprocess

base = Path(__file__).resolve().parent
app = base.parent / '2026-11-08_platform_audit/platform'
sources = [
 'regression-core-final.json', 'regression-db-final.json', 'regression-router-final.json',
 'increment1/final-lifecycle-regression.json', 'increment1/modal-render.json',
 'increment3/attribution-reviewed-final.json', 'increment2/tool-error-evidence/after.json',
 'increment3/experiment/mock-fixture-tests.json',
]
seen = set(); groups = []; duplicates = []
for relative in sources:
 data = json.loads((base / relative).read_text(encoding='utf-8-sig'))
 assert data['success'] and data['numTotalTests'] > 0 and data['numFailedTests'] == 0, relative
 unique = 0
 for file in data['testResults']:
  name = file['name'].replace('\\', '/')
  name = name.split('/platform/', 1)[-1]
  for assertion in file['assertionResults']:
   assert assertion['status'] == 'passed', (relative, assertion)
   key = (name, assertion['fullName'])
   if key in seen: duplicates.append({'source': relative, 'file': name, 'test': key[1]})
   else: seen.add(key); unique += 1
 groups.append({'source': relative, 'reportedPassed': data['numPassedTests'], 'distinctAdded': unique})
record = {'distinctPassed': len(seen), 'groups': groups, 'duplicates': duplicates,
 'boundary': 'Distinct latest selected Vitest assertions only; Python, HTTP, UI and experiment counts are separate.'}
(base/'REGRESSION_SUMMARY.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')

changes = json.loads((base/'SOURCE_CHANGES.json').read_text(encoding='utf-8'))
fixture = base/'patch-verification'; fixture.mkdir(exist_ok=True)
for item in changes['changedFiles']:
 target = fixture/item['path']
 assert target.resolve().is_relative_to(fixture.resolve())
 if item['kind'] == 'modified':
  original = (base/'audit/types/round1-snapshot'/item['path']).read_bytes()
  assert hashlib.sha256(original).hexdigest() == item['baselineSha256']
  target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(original)
 elif target.exists(): target.unlink()
events = []
for args in [['git','apply','--check','--ignore-space-change',str(base/'platform-phase2.patch')],
             ['git','apply','--ignore-space-change',str(base/'platform-phase2.patch')]]:
 result = subprocess.run(args, cwd=fixture, capture_output=True, text=True)
 events.append({'command': args, 'exitCode': result.returncode, 'output': result.stdout+result.stderr})
 if result.returncode: break
files = []
if len(events) == 2 and all(x['exitCode'] == 0 for x in events):
 for item in changes['changedFiles']:
  files.append({'path': item['path'], 'matches': (fixture/item['path']).read_text(encoding='utf-8-sig') == (app/item['path']).read_text(encoding='utf-8-sig')})
verification = {'events':events,'files':files,'passed':len(files)==len(changes['changedFiles']) and all(x['matches'] for x in files),
 'comparison': 'UTF-8 text after newline normalization; pristine round1 inputs verified with SHA256.'}
(base/'PATCH_VERIFICATION.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'distinctPassed':len(seen),'duplicates':len(duplicates),'patchPassed':verification['passed'],'changedFiles':len(changes['changedFiles'])}))
raise SystemExit(0 if verification['passed'] else 1)

from pathlib import Path
import difflib, zipfile

base = Path(__file__).resolve().parent
platform = base.parent.parent / '2026-11-08_platform_audit' / 'platform'
prefix = 'somethingelse-main-main/somethingelse-main/codinganalysis/lobehub/'
paths = [
    'packages/agent-runtime/src/utils/tokenCounter.ts',
    'packages/agent-runtime/src/utils/tokenCounter.test.ts',
    'src/server/services/agentEvalRun/index.ts',
    'src/server/services/agentEvalRun/__tests__/agentEvalRunService.judge.test.ts',
]
with zipfile.ZipFile(r'C:\Users\1\Desktop\实习\somethingelse-main-main.zip') as archive:
    diffs = []
    for path in paths:
        before = archive.read(prefix + path).decode('utf-8').splitlines(True) if prefix + path in archive.namelist() else []
        after = (platform / path).read_text(encoding='utf-8-sig').splitlines(True)
        diffs.extend(difflib.unified_diff(before, after, fromfile='a/' + path, tofile='b/' + path))
    (base / 'changes.patch').write_text(''.join(diffs), encoding='utf-8')

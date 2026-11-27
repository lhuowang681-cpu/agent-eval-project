"""Re-run the scoped offline scoring/parser regressions and save the actual exit code."""
import json
import os
from pathlib import Path
import subprocess
import time

base = Path(__file__).resolve().parent
platform = base.parent.parent / '2026-11-08_platform_audit/platform'
command = ['node', '../tooling/node_modules/vitest/vitest.mjs', 'run', '--config',
           '../tooling/audit-core.config.mts', 'packages/eval-rubric',
           'packages/eval-dataset-parser', '--reporter=default', '--reporter=json',
           f'--outputFile={base / "after.json"}']
env = {k: v for k, v in os.environ.items() if k.upper() in {
    'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'SYSTEMDRIVE'}}
env.update(NODE_ENV='test', CI='true', FORCE_COLOR='0')
started = time.perf_counter()
with (base / 'after.log').open('w', encoding='utf-8') as log:
    result = subprocess.run(command, cwd=platform, env=env, stdout=log,
                            stderr=subprocess.STDOUT, timeout=120)
record = dict(command=command, cwd=str(platform), exitCode=result.returncode,
              seconds=round(time.perf_counter() - started, 3))
(base / 'after-command.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps(record))
raise SystemExit(result.returncode)

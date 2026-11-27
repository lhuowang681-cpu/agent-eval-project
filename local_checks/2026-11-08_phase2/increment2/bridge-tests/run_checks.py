"""Focused TS boundary tests and scoped strict type check; preserves real exit codes."""
from pathlib import Path
import json
import os
import subprocess
import time

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parents[2] / '2026-11-08_platform_audit/platform'
TEST_DIR = 'src/server/services/agentEvalAttribution/__tests__/'
env = {key: value for key, value in os.environ.items() if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'SYSTEMDRIVE'}}
env.update(CI='true', FORCE_COLOR='0', EVAL_ATTRIBUTION_PYTHON='C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
commands = [
    ('regression', ['node', 'node_modules/vitest/vitest.mjs', 'run', '--config', str(HERE / 'vitest.config.mts')]),
    ('typecheck', ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--esModuleInterop', '--skipLibCheck', '--strict', '--types', 'node,vitest/globals', TEST_DIR + 'contracts.test.ts', TEST_DIR + 'python.integration.test.ts']),
]
records = []
for label, command in commands:
    start = time.perf_counter()
    with (HERE / (label + '.log')).open('w', encoding='utf-8') as output:
        process = subprocess.run(command, cwd=PLATFORM, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=60)
    records.append({'label': label, 'command': command, 'cwd': str(PLATFORM), 'exitCode': process.returncode, 'seconds': round(time.perf_counter() - start, 3)})
(HERE / 'command-results.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(records))
raise SystemExit(0 if all(record['exitCode'] == 0 for record in records) else 1)

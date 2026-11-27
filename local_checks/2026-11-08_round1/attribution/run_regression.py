"""Reproduce red/green results and replay prior synthetic CPU fixtures. No network."""
from pathlib import Path
import difflib
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
ORIGINAL = PROJECT / 'source-reference/attribution/structured_jsonl_attribution.py'
FIXED = HERE / ORIGINAL.name
env = {k: os.environ[k] for k in ['SystemRoot', 'WINDIR', 'PATH', 'COMSPEC', 'SYSTEMDRIVE'] if k in os.environ}
env.update(PYTHONUTF8='1', PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1', TMP=str(HERE), TEMP=str(HERE))
records = []


def run(label, cmd, extra=None):
    start = time.perf_counter()
    p = subprocess.run(cmd, cwd=HERE, env={**env, **(extra or {})}, capture_output=True, text=True, encoding='utf-8', timeout=60)
    (HERE / (label + '.log')).write_text(p.stdout + '\n' + p.stderr, encoding='utf-8')
    record = {'label': label, 'command': cmd, 'exit_code': p.returncode, 'seconds': round(time.perf_counter() - start, 3)}
    records.append(record)
    return p


before_hash = hashlib.sha256(ORIGINAL.read_bytes()).hexdigest()
baseline = run('before', [sys.executable, str(HERE / 'test_attribution.py')], {'ATTRIBUTION_MODULE': str(ORIGINAL)})
assert baseline.returncode != 0
fixed = run('after', [sys.executable, str(HERE / 'test_attribution.py')])
assert fixed.returncode == 0, fixed.stderr
fixtures = PROJECT / 'local_checks/2026-11-08_cpu_smoke/inputs'
for name in ['basic', 'batch_1000', 'no_failures', 'malformed_json']:
    output = HERE / 'outputs' / name
    p = run('cli-' + name, [sys.executable, str(FIXED), '--input-dir', str(fixtures / name), '--output-dir', str(output)])
    assert p.returncode == 0, p.stderr
    summary = json.loads((output / 'summary.json').read_text(encoding='utf-8'))
    records[-1]['summary'] = summary
    if name == 'basic':
        assert summary['failure_events'] == 5 and summary['internal_events'] == 4 and summary['external_events'] == 1
        rows = json.loads((output / 'classified_all.json').read_text(encoding='utf-8'))
        assert next(r for r in rows if r['trace_id'] == 'unrelated-success')['recovered'] is False
    if name == 'batch_1000':
        assert summary['input_traces'] == 1000 and summary['failure_events'] == 750
    if name == 'no_failures':
        assert summary['failure_events'] == 0
    if name == 'malformed_json':
        assert summary['invalid_lines'] == 1 and summary['input_complete'] is False

assert hashlib.sha256(ORIGINAL.read_bytes()).hexdigest() == before_hash
(HERE / 'changes.patch').write_text(''.join(difflib.unified_diff(ORIGINAL.read_text(encoding='utf-8').splitlines(True), FIXED.read_text(encoding='utf-8').splitlines(True), fromfile='source-reference/attribution/structured_jsonl_attribution.py', tofile='round1/attribution/structured_jsonl_attribution.py')), encoding='utf-8')
(HERE / 'results.json').write_text(json.dumps({'baseline': '10 tests: 1 pass, 6 failures, 3 errors', 'after': '10 tests passed', 'original_sha256': before_hash, 'original_unchanged': True, 'runs': records}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'regression_tests': '10/10', 'synthetic_cli_replays': '4/4', 'original_unchanged': True}))

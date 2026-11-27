"""Portable offline smoke, integrity manifest and ZIP. Never calls a model."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent


def main():
    receipt = []
    # This generated temporary tree is confined to this task's workspace.
    with tempfile.TemporaryDirectory(prefix='semantic-portable-', dir=BASE.parent) as temporary:
        parent = Path(temporary).resolve()
        assert parent.parent == BASE.parent.resolve()
        target = parent / 'semantic-vnext'
        shutil.copytree(BASE, target, ignore=shutil.ignore_patterns('__pycache__', '*.zip', 'FINAL_MANIFEST.json'))
        commands = [
            ['-m', 'unittest', 'test_shadow.Tests.test_three_types', 'test_shadow.Tests.test_metric_truth_evidence_and_unknown_separate'],
            ['run_experiment.py', 'replay', 'dev'],
            ['run_experiment.py', 'replay', 'holdout'],
            ['summarize.py'],
            ['verify_delivery.py'],
            ['-c', 'import run_experiment as r; assert r.RULES_DIR == r.BASE / "baseline"; print("portable_baseline_used")'],
        ]
        for command in commands:
            process = subprocess.run([sys.executable, '-B', *command], cwd=target, capture_output=True, timeout=60)
            receipt.append({'command': ['python', '-B', *command], 'exitCode': process.returncode})
            if process.returncode:
                raise RuntimeError(process.stderr.decode(errors='replace')[:1000])
        envelope = (target / 'data/dev.jsonl').read_bytes().splitlines()[0]
        process = subprocess.run([sys.executable, '-B', '-m', 'shadow.cli'], input=envelope, cwd=target, capture_output=True, timeout=10)
        assert process.returncode == 0 and json.loads(process.stdout)['decision'] == 'supported'
        receipt.append({'command': ['python', '-B', '-m', 'shadow.cli'], 'exitCode': 0, 'decision': 'supported'})
    (BASE / 'results/portable-verification.json').write_text(json.dumps({'checks': receipt, 'externalCalls': 0, 'originalPlatformUsedByReplay': False}, indent=2), encoding='utf-8')
    verified = subprocess.run([sys.executable, '-B', 'verify_delivery.py'], cwd=BASE, capture_output=True, timeout=10)
    assert verified.returncode == 0, verified.stderr.decode(errors='replace')
    (BASE / 'results/delivery-verification.json').write_text(verified.stdout.decode(), encoding='utf-8')
    files = sorted(path for path in BASE.rglob('*') if path.is_file() and '__pycache__' not in path.parts and path.name != 'FINAL_MANIFEST.json' and path.suffix != '.zip')
    manifest = {str(path.relative_to(BASE)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    final = BASE / 'FINAL_MANIFEST.json'
    final.write_text(json.dumps({'stage': 'final_delivery_NOT_pretest_freeze', 'files': manifest}, ensure_ascii=False, indent=2), encoding='utf-8')
    archive = BASE.parent / 'Semantic_VNext_Shadow_2026-11-10.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as stream:
        for path in files + [final]:
            stream.write(path, 'semantic-vnext/' + path.relative_to(BASE).as_posix())
    with zipfile.ZipFile(archive) as stream:
        assert stream.testzip() is None
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files) + 1, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'portableChecks': len(receipt), 'externalCalls': 0}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()

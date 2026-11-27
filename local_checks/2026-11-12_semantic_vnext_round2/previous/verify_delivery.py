"""Verify local delivery integrity. No network, keys or database access."""
import hashlib
import json
import re
from pathlib import Path, PureWindowsPath

BASE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    data_manifest = json.loads((BASE / 'data/MANIFEST.json').read_text(encoding='utf-8'))
    assert all(digest(BASE / 'data' / name) == expected for name, expected in data_manifest['files'].items())
    source = json.loads((BASE / 'SOURCE_FREEZE.json').read_text(encoding='utf-8'))
    available = [Path(path) for path in source if Path(path).exists()]
    assert all(digest(path) == source[str(path)] for path in available)
    for name in ['adapter.py', 'rules_pure.py', 'evidence_review.py']:
        expected = next(value for path, value in source.items() if PureWindowsPath(path).name == name)
        assert digest(BASE / 'baseline' / name) == expected
    for name in ['IMPLEMENTATION_AUDIT', 'SEMANTIC_ATTRIBUTION_DESIGN', 'EXPERIMENT_RESULTS', 'ABLATION_RESULTS', 'PROMOTION_DECISION', 'INTERVIEW_TECHNICAL_SUMMARY']:
        assert (BASE / (name + '.md')).stat().st_size > 100
    ledger = json.loads((BASE / 'results/real_attempts.json').read_text(encoding='utf-8'))
    assert ledger == {'maximumRequests': 6, 'attempts': 6}
    real = json.loads((BASE / 'results/real-holdout.json').read_text(encoding='utf-8'))
    assert len(real['records']) == 6 and real['realCalls'] == 6
    assert all(record['transport']['error'] is None for record in real['records'])
    assert real['datasetSha256'] == digest(BASE / 'data/holdout.jsonl')
    scanned = 0
    for path in BASE.rglob('*'):
        if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.zip':
            scanned += 1
            assert not re.search(rb'sk-[A-Za-z0-9_-]{24,}', path.read_bytes()), 'Potential credential in ' + path.name
    result = {'dataHashesUnchanged': True, 'availableOriginalFilesUnchanged': len(available), 'portableBaselineMatchesOriginal': True, 'realCalls': 6, 'credentialPatternScanFiles': scanned, 'credentialPatternMatches': 0, 'note': 'Pattern scan is not comprehensive secret/PII certification; no production data exported.'}
    if (BASE / 'FINAL_MANIFEST.json').exists():
        manifest = json.loads((BASE / 'FINAL_MANIFEST.json').read_text(encoding='utf-8'))
        assert all(digest(BASE / path) == expected for path, expected in manifest['files'].items())
        result['finalManifestVerified'] = True
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

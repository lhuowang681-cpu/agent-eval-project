"""Offline review: python -m shadow.cli --input envelope.json (or stdin).

Accept {trajectory, candidate}; frozen dataset rows use fixtureCandidate instead.
No model calls, database writes or platform imports.
"""
import argparse
import json
import sys
from pathlib import Path

from .semantic_review import review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    try:
        with args.input.open('rb') if args.input else __import__('contextlib').nullcontext(sys.stdin.buffer) as stream:
            raw = stream.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError('input_too_large')
        envelope = json.loads(raw.decode('utf-8-sig'), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))
        if not isinstance(envelope, dict) or not isinstance(envelope.get('trajectory'), dict):
            raise ValueError('invalid_envelope')
        candidate = envelope.get('candidate', envelope.get('fixtureCandidate'))
        output = review(envelope['trajectory'], candidate)
    except (OSError, ValueError, TypeError, KeyError):
        output = {'decision': 'needs_review', 'error': 'invalid_input', 'supportedObservations': []}
    print(json.dumps(output, ensure_ascii=True, allow_nan=False))
    return 1 if 'error' in output else 0


if __name__ == '__main__':
    raise SystemExit(main())

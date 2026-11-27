"""Fixed stdio reviewer for an untrusted diagnostic candidate; no LLM or network."""
import json
import sys
from adapter import MAX_BYTES, ContractError, require, validate
from evidence_review import audited_candidate, issue


def main():
    trajectory = {}
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, 'Input exceeds limit')
        request = json.loads(raw.decode('utf-8'), parse_constant=lambda _: (_ for _ in ()).throw(ContractError('Nonfinite number')))
        require(isinstance(request, dict) and set(request) == {'trajectory', 'candidate'}, 'Invalid review envelope')
        trajectory = request['trajectory']
        validate(trajectory)
        output = audited_candidate(trajectory, request['candidate'])
        exit_code = 0
    except (ContractError, ValueError, TypeError, KeyError, RecursionError):
        safe_source = trajectory if isinstance(trajectory, dict) else {}
        output = {
            'review': {'existence': {'status': 'invalid', 'issues': [issue('invalid_review_input', 'Source or envelope failed validation')]}, 'support': {'status': 'insufficient', 'issues': []}},
            'sourceDigest': safe_source.get('inputDigest', ''), 'scope': safe_source.get('scope', {}), 'safeCandidate': None,
        }
        exit_code = 1
    except Exception:
        output = {'review': {'existence': {'status': 'invalid', 'issues': [issue('reviewer_error', 'Reviewer failed without a trusted conclusion')]}, 'support': {'status': 'insufficient', 'issues': []}}, 'sourceDigest': '', 'scope': {}, 'safeCandidate': None}
        exit_code = 1
    sys.stdout.write(json.dumps(output, ensure_ascii=True, allow_nan=False) + '\n')
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())

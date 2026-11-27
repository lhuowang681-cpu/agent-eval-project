"""Rescore SAVED responses only; never calls a model or mutates data/gold."""
import copy
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

from run_experiment import stats
from shadow.semantic_review import review

BASE = Path(__file__).resolve().parent


def citation_valid(trajectory, candidate, observation):
    if not isinstance(candidate, dict) or candidate.get('scope') != trajectory['scope'] or candidate.get('inputDigest') != trajectory['inputDigest']:
        return False
    nodes = {n['id']: n for n in trajectory['nodes']}
    refs = observation.get('evidenceRefs', [])
    if not isinstance(refs, list) or not refs:
        return False
    for ref in refs:
        if not isinstance(ref, dict):
            return False
        node = nodes.get(ref.get('nodeId'))
        value = node.get(ref.get('field')) if node else None
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False, sort_keys=True)
        if not node or not isinstance(ref.get('quote'), str) or not ref['quote'] or ref['quote'] not in value:
            return False
    return True


def main():
    aggregate = {}
    rejected = []
    case_rows = []
    for name in ['replay-dev', 'replay-holdout', 'real-holdout']:
        path = BASE / 'results' / (name + '.json')
        data = json.loads(path.read_text(encoding='utf-8'))
        records_digest = hashlib.sha256(json.dumps(data['records'], sort_keys=True).encode()).hexdigest()
        split = 'dev' if name.endswith('dev') else 'holdout'
        byid = {r['id']: r for r in map(json.loads, (BASE / 'data' / (split + '.jsonl')).read_text(encoding='utf-8').splitlines())}
        rows = [byid[r['id']] for r in data['records']]
        for record, row in zip(data['records'], rows):
            assert review(row['trajectory'], record['candidate']) == record['review'], 'Saved verdict differs from final reviewer'
        if not (BASE / 'results' / (name + '.initial-metrics.json')).exists():
            (BASE / 'results' / (name + '.initial-metrics.json')).write_text(json.dumps({'metrics': data['metrics'], 'note': 'Prior evaluator output retained; use final metrics, see EVALUATOR_CHANGELOG.md'}, indent=2), encoding='utf-8')
        data['metrics'] = stats(data['records'], rows)
        assert hashlib.sha256(json.dumps(data['records'], sort_keys=True).encode()).hexdigest() == records_digest
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        ablations = {}
        for layer in ['structure_only', 'citations_and_identity', 'local_support', 'local_support_plus_global_gate']:
            records = copy.deepcopy(data['records'])
            for record, row in zip(records, rows):
                if layer == 'structure_only':
                    candidate = record.get('candidate') or {}
                    observations = candidate.get('observations', [])
                    record['reviewed'] = [o for o in observations if isinstance(o, dict) and set(o) == {'id', 'category', 'claimLevel', 'summary', 'evidenceRefs', 'comparison'}] if candidate.get('scope') == row['trajectory']['scope'] and candidate.get('inputDigest') == row['trajectory']['inputDigest'] else []
                elif layer == 'citations_and_identity':
                    record['reviewed'] = [o for o in record['direct'] if isinstance(o, dict) and citation_valid(row['trajectory'], record['candidate'], o)]
                elif layer == 'local_support_plus_global_gate' and not row['trajectory']['coverage']['complete']:
                    record['reviewed'] = []
            ablations[layer] = stats(records, rows)['reviewed']
        aggregate[name] = {'mode': data['mode'], 'metrics': data['metrics'], 'ablation': ablations, 'recordsSha256': records_digest}
        for record, row in zip(data['records'], rows):
            metrics = stats([record], [row])
            for method, metric in metrics.items():
                case_rows.append({'experiment': name, 'id': row['id'], 'kind': row['kind'], 'method': method, **{k: v for k, v in metric.items() if k != 'byType'}})
            for verdict in record['review'].get('reviews', []):
                if verdict['support'] != 'supported':
                    rejected.append({'experiment': name, 'id': row['id'], 'kind': row['kind'], **verdict})
            if record['review'].get('error'):
                rejected.append({'experiment': name, 'id': row['id'], 'kind': row['kind'], 'issues': [record['review']['error']]})
    real = json.loads((BASE / 'results/real-holdout.json').read_text(encoding='utf-8'))
    tokens = Counter()
    seconds = []
    for record in real['records']:
        tokens.update({k: v for k, v in record['transport']['usage'].items() if isinstance(v, int)})
        seconds.append(record['transport']['seconds'])
    # Official deepseek-flash Nov 2026 USD/1M token peak prices; off-peak half.
    upper = (tokens['prompt_cache_hit_tokens'] * .006 + tokens['prompt_cache_miss_tokens'] * .3 + tokens['completion_tokens'] * 1.2) / 1_000_000
    aggregate['real_usage'] = {'requests': len(real['records']), 'tokens': dict(tokens), 'totalSeconds': round(sum(seconds), 3), 'meanSeconds': round(sum(seconds) / len(seconds), 3), 'maxSeconds': max(seconds), 'estimatedUsdRange': [round(upper / 2, 8), round(upper, 8)], 'actualBill': None, 'pricingSource': 'https://api-docs.deepseek.com/quick_start/pricing/'}
    (BASE / 'results/summary.json').write_text(json.dumps(aggregate, ensure_ascii=False, indent=2), encoding='utf-8')
    (BASE / 'results/rejections.json').write_text(json.dumps(rejected, ensure_ascii=False, indent=2), encoding='utf-8')
    with (BASE / 'results/per-case.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(case_rows[0]))
        writer.writeheader()
        writer.writerows(case_rows)
    print(json.dumps(aggregate, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()

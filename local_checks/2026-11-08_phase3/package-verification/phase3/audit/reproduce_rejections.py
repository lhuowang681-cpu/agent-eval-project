"""Read-only audit of stored candidates and reviewer behavior; writes only this directory."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
PHASE2 = PROJECT / 'local_checks/2026-11-08_phase2'
ENGINE = HERE.parent / 'baseline'
sys.path.insert(0, str(ENGINE))
from adapter import analyze
from evidence_review import audited_candidate

FILES = {
    'reviewer': ENGINE / 'evidence_review.py', 'adapter': ENGINE / 'adapter.py',
    'trace': HERE / 'source-snapshot/trace.ts',
    'contracts': HERE / 'source-snapshot/contracts.ts',
    'experiment': PHASE2 / 'increment3/experiment/results.json',
    'http': PHASE2 / 'increment2/http/results.json',
    'rules': ENGINE / 'rules_pure.py',
}
before = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in FILES.items()}
assert before['reviewer'] == 'd9ea1fb10ade950a05118904cade82882fba26227735bb0474eeff67aa986f29', 'Frozen baseline reviewer changed'
assert before['adapter'] == 'b01d67cbc49778e60e5e0abdf748610514a001930fe15764521fad10d4624d2b', 'Frozen baseline adapter changed'
assert before['rules'] == 'c8c2984316aa0e56d283bdeb3afa7f2d0ed53b87f02b0a9d2a4fbc8d2980767e', 'Frozen baseline rules changed'
def load(path):
    return json.loads(path.read_text(encoding='utf-8'))
def codes(review):
    return [issue['code'] for part in review.values() for issue in part['issues']]
def has_claim(candidate):
    return bool(candidate.get('category') or candidate.get('moduleId') or candidate.get('evidenceRefs') or candidate.get('claimLevel') == 'root_cause' or candidate.get('status') == 'resolved')
def decision(candidate, result):
    if not has_claim(candidate):
        return 'no_claim_not_rejection'
    return 'accepted_observation' if result['safeCandidate'] is not None else 'rejected_claim'
def assessment(case, outcome, issue_codes):
    if outcome == 'no_claim_not_rejection':
        return {'class': 'no_claim_not_rejection', 'extractionOmission': 'not_established', 'note': 'Unknown without category/module/references is abstention, not a rejected candidate or proof of no business problem.'}
    if outcome == 'accepted_observation':
        return {'class': 'accepted_observation_only', 'extractionOmission': 'not_established', 'note': 'No originating module responsibility is proven.'}
    if 'incomplete_source_coverage' in issue_codes:
        return {'class': 'reviewer_global_coverage_overrestriction', 'sourceGap': 'Parent/operation/provider evidence is incomplete; single-node failure evidence may still suffice for an observation.', 'extractionOmission': 'not_established', 'labelCaveat': 'Synthetic semantic labels are not real-user annotations.'}
    if case == 'supported_paraphrase':
        return {'class': 'reviewer_verbatim_summary_overrestriction', 'sourceGap': 'No missing node or quote in this claim.', 'extractionOmission': 'not_established', 'labelCaveat': 'Supported as an external-failure observation only, not as a root cause.'}
    if case == 'unknown_source':
        return {'class': 'source_provenance_insufficient', 'extractionOmission': 'not_established', 'note': 'Fixture explicitly has unknown toolSource; no evidence it was lost by extraction.'}
    if case == 'no_failure_signal':
        return {'class': 'source_failure_signal_absent', 'extractionOmission': 'not_established', 'note': 'Failed task scoring alone does not establish a structured runtime failure.'}
    return {'class': 'candidate_invalid_or_exceeds_evidence', 'extractionOmission': 'not_established', 'note': 'Stored claim has a fabricated/cross-scope reference, invalid label, or unproven causal assertion.'}
def first_line(name, needle):
    return next(i for i, line in enumerate(FILES[name].read_text(encoding='utf-8').splitlines(), 1) if needle in line)

experiment = load(FILES['experiment'])
records = []
for original in experiment['records']:
    trajectory = original['trajectory']
    for method, candidate, stored in [('rules', original['rules']['diagnosis'], original['rulesReview']), ('direct', original['direct']['output'], original['review'])]:
        replay = audited_candidate(trajectory, candidate)
        outcome = decision(candidate, replay)
        issue_codes = codes(replay['review'])
        records.append({'id': original['id'], 'method': method, 'candidate': candidate, 'labels': original['labels'], 'coverage': trajectory['coverage'], 'decision': outcome, 'review': replay['review'], 'issueCodes': issue_codes, 'assessment': assessment(original['id'], outcome, issue_codes), 'storedReviewMatchesReplay': replay['review'] == stored['review']})

http_records = []
http = load(FILES['http'])
for event in http['events']:
    if event['stage'] != 'diagnostic-result':
        continue
    trajectory, job = event['trace'], event['job']
    candidate = job['result']['diagnosis']
    replay = audited_candidate(trajectory, candidate)
    outcome = decision(candidate, replay)
    issue_codes = codes(replay['review'])
    http_records.append({'jobId': job['id'], 'scope': trajectory['scope'], 'candidate': candidate, 'coverage': trajectory['coverage'], 'decision': outcome, 'review': replay['review'], 'issueCodes': issue_codes, 'assessment': assessment('http', outcome, issue_codes), 'storedReviewMatchesReplay': replay['review'] == job['result']['review'], 'nodes': trajectory['nodes'], 'executionStatus': job['status']})

base = next(r for r in experiment['records'] if r['id'] == 'valid_observation_template')['trajectory']
probes = []
def probe(name, trajectory, candidate, meaning):
    trajectory = copy.deepcopy(trajectory)
    # Same canonical input identity rule as the TS exporter for these JSON fixtures.
    unsigned = {**trajectory, 'inputDigest': None}
    trajectory['inputDigest'] = hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    audited = audited_candidate(trajectory, candidate)
    probes.append({'name': name, 'meaning': meaning, 'trajectory': trajectory, 'candidate': candidate, 'result': audited, 'decision': decision(candidate, audited)})

for label in ['missing_parent', 'supported_paraphrase']:
    record = next(r for r in experiment['records'] if r['id'] == label)
    if label == 'missing_parent':
        changed = copy.deepcopy(record['trajectory'])
        changed['coverage'] = {'source': 'database_messages', 'complete': True, 'warnings': []}
        probe('coverage_only_counterfactual', changed, record['direct']['output'], 'Only diagnostic input coverage metadata changed; original source is still incomplete. This isolates the gate and is NOT permission to relabel production coverage.')
    else:
        candidate = copy.deepcopy(record['direct']['output'])
        candidate['summary'] = record['rules']['diagnosis']['summary']
        probe('summary_only_counterfactual', record['trajectory'], candidate, 'Only summary wording changed, not facts or root ownership. Acceptance is not proof of causal correctness.')

changed = copy.deepcopy(base)
tool = next(n for n in changed['nodes'] if n['role'] == 'tool')
tool['content'] = 'This field says the lookup succeeded.'
candidate = analyze(changed)['diagnosis']
candidate['evidenceRefs'] = [{'nodeId': tool['id'], 'field': 'content', 'quote': tool['content']}]
probe('uncited_error_field_acceptance', changed, candidate, 'Cites success text in content, while observed_category reads uncited error. Failure fact exists elsewhere, but cited field does not support it.')

changed = copy.deepcopy(base)
tool = next(n for n in changed['nodes'] if n['role'] == 'tool')
tool['error'] = None
tool['content'] = json.dumps({'success': True, 'data': {'success': False, 'message': 'An example of an old failure'}}, ensure_ascii=False)
candidate = analyze(changed)['diagnosis']
probe('nested_business_false_positive', changed, candidate, 'Top-level tool success is true; recursive failure scanning mistakes nested business data for execution failure. Synthetic counterexample, not a claim that the stored HTTP case was successful.')

changed = copy.deepcopy(base)
tool = next(n for n in changed['nodes'] if n['role'] == 'tool')
extra = copy.deepcopy(tool)
extra.update(id='extra-permission-result', messageId='extra-permission-result', toolCallId='another-call', sequence=100, error={'message': 'permission denied'}, content='')
extra_call = copy.deepcopy(next(n for n in changed['nodes'] if n['role'] == 'call'))
extra_call.update(id='extra-permission-call', toolCallId='another-call', sequence=99)
extra['parentId'] = extra_call['id']
changed['nodes'].extend([extra_call, extra])
rule = analyze(changed)
probe('multiple_categories_aggregate', changed, rule['diagnosis'], 'Both concrete observations retained, but aggregate category becomes null and is rejected; evaluate individual observations separately from an aggregate summary.')
single = copy.deepcopy(rule['diagnosis'])
single['category'] = rule['observations'][-1]['category']
single['evidenceRefs'] = rule['observations'][-1]['evidenceRefs']
probe('multiple_categories_single_observation', changed, single, 'One grounded observation is accepted; this does not claim to cover all failures in the trajectory.')

code_lines = []
for number, line in enumerate(FILES['reviewer'].read_text(encoding='utf-8').splitlines(), 1):
    match = re.search(r"issue\('([^']+)'", line)
    if match:
        code_lines.append({'issueCode': match.group(1), 'file': str(FILES['reviewer']), 'line': number, 'code': line.strip()})
locations = {
    'global_coverage_gate': first_line('reviewer', "if not payload['coverage']['complete']"),
    'summary_exact_match': first_line('reviewer', "if candidate['summary'] not in summaries"),
    'matching_category_reads_whole_node': first_line('reviewer', 'matches = [n for n, field in cited'),
    'trace_unconditional_warnings': first_line('trace', 'const warnings = new Set'),
    'trace_complete_all_warnings': first_line('trace', 'complete: warnings.size === 0'),
    'ts_quote_presence_only': first_line('contracts', '!evidenceText(node[reference.field]).includes'),
    'recursive_failure_scan': first_line('rules', 'for k,v in flat.items()'),
    'multi_category_null': first_line('adapter', "category=observations[0]['category']"),
}
summary = {}
for method in ['rules', 'direct']:
    subset = [r for r in records if r['method'] == method]
    summary[method] = {key: sum(r['decision'] == key for r in subset) for key in ['accepted_observation', 'rejected_claim', 'no_claim_not_rejection']}
summary['http'] = {key: sum(r['decision'] == key for r in http_records) for key in ['accepted_observation', 'rejected_claim', 'no_claim_not_rejection']}
after = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in FILES.items()}
assert before == after
output = {'mode': 'readonly_frozen_baseline_replay_and_counterexamples', 'baselinePinned': True, 'summary': summary, 'sourcePaths': {name: str(path) for name, path in FILES.items()}, 'sourceHashes': before, 'sourceFilesUnchanged': True, 'lineLocations': locations, 'ruleIssueLines': code_lines, 'experimentConditions': experiment['conditions'], 'experimentRecords': records, 'httpRecords': http_records, 'probes': probes, 'caveats': ['Synthetic labels are not real-user ground truth', 'No real LLM/model-quality test or DB access', 'Counterfactual inputs are local clones, not production data fixes', 'Reviewer/adapter/rules are pinned to phase3/baseline, not mutable optimized platform code; TS files are exact original-hash snapshots']}
(HERE / 'REJECTION_AUDIT.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'summary': summary, 'probeDecisions': {p['name']: p['decision'] for p in probes}, 'sourceFilesUnchanged': True}))

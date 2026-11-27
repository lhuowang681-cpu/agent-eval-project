"""Pure statistics-contract probes on a pinned reviewed snapshot; no holdout/model reads."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'source-snapshot/metrics-before.py'
spec = importlib.util.spec_from_file_location('audited_metrics_snapshot', SOURCE)
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)


def row(case_id='one'):
    return {'id': case_id, 'trajectory': {'nodes': [{'id': 'error-node', 'content': 'lookup succeeded', 'error': {'message': 'HTTP 500'}, 'arguments': '{}'}]}, 'candidate': observation(), 'labels': {'candidateCorrect': True, 'candidateSupported': True, 'observationCategories': ['external_tool_failure'], 'observationEligible': True, 'root': {'known': False, 'moduleId': None, 'category': None}}}


def observation():
    return {'status': 'needs_review', 'category': 'external_tool_failure', 'moduleId': None, 'claimLevel': 'observation', 'summary': 'A tool failure was observed', 'evidenceRefs': [{'nodeId': 'error-node', 'field': 'error', 'quote': 'HTTP 500'}], 'reasonCodes': []}


def record(source, value=None):
    return {'id': source['id'], 'outcomes': {method: {'output': copy.deepcopy(value if value is not None else source['candidate']), 'executionError': None, 'localSeconds': 0.01} for method in ['rules', 'direct', 'structured', 'citations', 'full']}}


probes = {}
source = row()
bad_reference = observation()
bad_reference['evidenceRefs'] = [{'nodeId': 'error-node', 'field': 'content', 'quote': 'lookup succeeded'}]
probes['valid_quote_not_supported_default_rules'] = {'references': metrics.valid_references(source['trajectory'], bad_reference), 'support': metrics.support(source, bad_reference, 'rules'), 'why_unreliable': 'Only the success content is cited; eligibility says a failure can be observed elsewhere, not that this citation supports it.'}
source['labels']['candidateSupported'] = False
probes['full_inherits_raw_support_label'] = {'support': metrics.support(source, observation(), 'full'), 'why_unreliable': 'Canonical observation cites the actual error; omitted safeCanonicalSupported inherits the raw candidate label instead of independent output adjudication.'}

sources = [row(str(i)) for i in range(10)]
for item in sources[1:]:
    item['candidate'].update(moduleId='L2.2', claimLevel='root_cause')
    item['labels'].update(candidateCorrect=None, candidateSupported=False)
stats = metrics.summarize(sources, {'records': [record(item) for item in sources]})
probes['risk_coverage_unknown_population'] = {'direct': stats['metrics']['direct'], 'point': next(p for p in stats['riskCoveragePoints'] if p['gate'] == 'direct'), 'independent_known_error_lower_bound': 0, 'independent_unadjudicated_upper_bound': 0.9}

source = row()
duplicate = metrics.summarize([source], {'records': [record(source), record(source)]})
probes['duplicate_output_ids'] = duplicate['metrics']['direct']
missing = metrics.summarize([source], {'records': []})
probes['missing_output_record'] = missing['metrics']['direct']

unknown = {**observation(), 'status': 'unknown', 'category': None, 'evidenceRefs': []}
probes['unknown_without_claim'] = metrics.summarize([source], {'records': [record(source, unknown)]})['metrics']['direct']
probes['root_unknown_is_unadjudicated'] = {'correctness': metrics.correctness(sources[1], sources[1]['candidate'], 'direct'), 'support': metrics.support(sources[1], sources[1]['candidate'], 'direct')}

source = row()
failed = record(source)
failed['outcomes']['full'].update(output=None, executionError='RuntimeError')
probes['execution_error_vs_false_refusal'] = metrics.summarize([source], {'records': [failed]})['metrics']['full']

bad = observation()
bad['evidenceRefs'][0]['nodeId'] = []
try:
    metrics.valid_references(source['trajectory'], bad)
    malformed = {'raised': False}
except Exception as error:
    malformed = {'raised': True, 'type': type(error).__name__}
probes['malformed_raw_reference'] = malformed

output = {'mode': 'independent_authored_statistics_probes_not_model_evaluation', 'source': str(SOURCE), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'holdoutRead': False, 'probes': probes}
(HERE / 'METRICS_PROBES.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'rulesDefaultSupport': probes['valid_quote_not_supported_default_rules']['support'], 'riskPoint': probes['risk_coverage_unknown_population']['point'], 'duplicateCoverage': probes['duplicate_output_ids']['claimCoverage'], 'missingAsAbstention': probes['missing_output_record']['abstentions'], 'unknownCorrectClaims': probes['unknown_without_claim']['correctClaims'], 'malformedReference': malformed}))

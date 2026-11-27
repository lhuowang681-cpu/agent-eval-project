"""Read-only, offline contract probes. Extract pure definitions without dotenv/LLM clients."""
from pathlib import Path
import ast
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[3]
SOURCE = PROJECT / 'source-reference/attribution'
def literal(name, tree):
    return next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets))
tree = ast.parse((SOURCE / 'taxonomy.py').read_text(encoding='utf-8'))
rows = literal('ROWS', tree)
layers = literal('LAYER_NAMES', tree)
def get_module_by_id(mid):
    return {'name': rows[mid][0], 'layer_id': mid.split('.')[0], 'layer_name': layers[mid.split('.')[0]]} if mid in rows else None
source = SOURCE / 'llm_classifier.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
definitions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'_safe', '_fallback', 'normalize_result'}]
namespace = {'re': re, 'json': json, 'Any': object, 'get_module_by_id': get_module_by_id, 'REVIEW_THRESHOLD': 0.72}
exec(compile(ast.Module(body=definitions, type_ignores=[]), str(source), 'exec'), namespace)
trace = {'id': 'synthetic-trace', 'error_type': 'ActualError', 'denoised_trace': [{'node_id': 'real-node', 'content': 'Tool returned 500'}]}
raw = {'module_id': 'L2.2', 'confidence': 0.99, 'badcase_kind': 'not_an_allowed_kind', 'original_error_type': 'FabricatedError', 'first_abnormal_node_id': 'missing-node', 'root_cause_evidence_node_ids': ['missing-node'], 'evidence': ['missing-node: claimed Agent generated bad parameters']}
normalized = namespace['normalize_result'](raw, trace)
invalid = namespace['normalize_result']({'module_id': 'L99.9'}, trace)
probes = {
    'conditions': 'Offline AST-extracted pure functions only; no imports of llm_classifier, dotenv, LLM calls, or business edits',
    'taxonomy_module_count': len(rows),
    'evidence_gate_gap': {'input': raw, 'normalized': normalized, 'observed_missing_node_retained': normalized['first_abnormal_node_id'] == 'missing-node', 'observed_needs_review_false': normalized['needs_review'] is False},
    'illegal_module_fallback': invalid,
    'interpretation': 'Source normalization checks module membership but not evidence existence/support; accepts non-enum kind and overrides real original_error_type. Existing prompt requirements are not runtime validation.',
    'source_sha256': {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [source, SOURCE / 'taxonomy.py', PROJECT / 'local_checks/2026-11-08_round1/attribution/structured_jsonl_attribution.py']},
}
(HERE / 'probe-results.json').write_text(json.dumps(probes, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'offline': True, 'modules': len(rows), 'missing_evidence_accepted': normalized['first_abnormal_node_id'] == 'missing-node', 'illegal_module_fallback': invalid['module_id']}))

"""One bounded JSON request/result over stdin/stdout; standard library, no model/network."""
from __future__ import annotations
import json
import math
import re
import sys
from rules_pure import SOURCE_SHA256, RULES_VERSION, PROVIDER_CONTRACTS, failure_envelope, classify_builtin, classify_external

MAX_BYTES = 1024 * 1024
CATEGORIES = frozenset([
    'context_window_exceeded', 'provider_payload_invalid', 'thinking_type_invalid', 'model_missing',
    'builtin_tool_contract_invalid', 'builtin_tool_unavailable', 'builtin_result_parse_failed', 'builtin_tool_failure_unclassified',
    'external_permission', 'external_credential', 'external_quota', 'external_timeout', 'external_transport', 'external_tool_failure',
])
ROLES = {'system', 'user', 'assistant', 'tool', 'call', 'error'}
SOURCES = {'builtin', 'mcp', 'plugin', 'unknown'}


class ContractError(ValueError):
    pass


def serialize(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def require(condition, message):
    if not condition:
        raise ContractError(message)


def validate(payload):
    require(isinstance(payload, dict), 'Root must be an object')
    require(payload.get('schemaVersion') == 1 and type(payload.get('schemaVersion')) is int, 'Unsupported schemaVersion')
    for key in ['trajectoryId', 'inputDigest']:
        require(isinstance(payload.get(key), str) and bool(payload[key]), key + ' must be nonempty')
    scope = payload.get('scope')
    require(isinstance(scope, dict), 'scope must be an object')
    for key in ['runId', 'caseId', 'topicId']:
        require(isinstance(scope.get(key), str) and bool(scope[key]), 'Invalid scope.' + key)
    for key in ['threadId', 'operationId']:
        require(key in scope and (scope[key] is None or isinstance(scope[key], str)), 'Invalid scope.' + key)
    require(isinstance(scope.get('traceIds'), list) and all(isinstance(x, str) for x in scope['traceIds']), 'Invalid traceIds')
    nodes = payload.get('nodes')
    require(isinstance(nodes, list) and len(nodes) <= 500, 'nodes must be an array of at most 500')
    ids = set()
    for node in nodes:
        require(isinstance(node, dict), 'Invalid node')
        for key in ['id', 'sourcePointer']:
            require(isinstance(node.get(key), str) and bool(node[key]), 'Invalid node.' + key)
        require(node['id'] not in ids, 'Duplicate node id')
        ids.add(node['id'])
        require(node.get('role') in ROLES, 'Invalid role')
        require(node.get('toolSource') in SOURCES, 'Invalid toolSource')
        require(isinstance(node.get('content'), str), 'Invalid node.content')
        for key in ['messageId', 'parentId', 'toolCallId', 'toolName', 'arguments', 'traceId', 'createdAt']:
            require(key in node and (node[key] is None or isinstance(node[key], str)), 'Invalid node.' + key)
        require('error' in node, 'Missing node.error')
        require(type(node.get('sequence')) is int and node['sequence'] >= 0, 'Invalid sequence')
    evaluation = payload.get('evaluation')
    require(isinstance(evaluation, dict), 'Invalid evaluation')
    for key in ['status', 'task']:
        require(isinstance(evaluation.get(key), str), 'Invalid evaluation.' + key)
    for key in ['expected', 'actual', 'criteria']:
        require(key in evaluation and (evaluation[key] is None or isinstance(evaluation[key], str)), 'Invalid evaluation.' + key)
    score = evaluation.get('score')
    require('score' in evaluation and (score is None or type(score) in {int, float} and math.isfinite(score) and 0 <= score <= 1), 'Invalid evaluation.score')
    coverage = payload.get('coverage')
    require(isinstance(coverage, dict) and coverage.get('source') == 'database_messages' and type(coverage.get('complete')) is bool, 'Invalid coverage')
    require(isinstance(coverage.get('warnings'), list) and all(isinstance(x, str) for x in coverage['warnings']), 'Invalid coverage.warnings')


def base_result(payload):
    scope = payload.get('scope') if isinstance(payload.get('scope'), dict) else {}
    return {
        'schemaVersion': 1, 'trajectoryId': payload.get('trajectoryId', ''), 'inputDigest': payload.get('inputDigest', ''),
        'scope': scope, 'jobExecution': {'status': 'completed', 'errors': []},
        'diagnosis': {'status': 'unknown', 'category': None, 'moduleId': None, 'claimLevel': 'observation', 'summary': 'No supported root-cause conclusion', 'evidenceRefs': [], 'reasonCodes': []},
        'observations': [], 'coverage': payload.get('coverage', {'source': 'database_messages', 'complete': False, 'warnings': ['invalid_input']}),
        'provenance': {'rulesVersion': RULES_VERSION, 'sourceSha256': SOURCE_SHA256},
    }


def reference(node, field):
    return {'nodeId': node['id'], 'field': field, 'quote': serialize(node[field])[:300]}


def analyze(payload):
    validate(payload)
    result = base_result(payload)
    observations = result['observations']
    codes = []
    ids = {node['id'] for node in payload['nodes']}
    calls = {}
    for node in payload['nodes']:
        if node['role'] in {'call', 'assistant'} and node['toolCallId']:
            calls.setdefault(node['toolCallId'], []).append(node)
        if node['parentId'] and node['parentId'] not in ids:
            codes.append('dangling_parent')
    for node in payload['nodes']:
        if node['role'] in {'system', 'user', 'call'}:
            continue
        has_error = node['error'] not in (None, {}, [], '', False, 0)
        failed, _, flat = failure_envelope(node['content']) if node['role'] == 'tool' else (False, [], {})
        if not has_error and not failed:
            continue
        field = 'error' if has_error else 'content'
        refs = [reference(node, field)]
        category = None
        summary = ''
        if node['role'] == 'tool':
            matches = [n for n in calls.get(node['toolCallId'], []) if n['sequence'] < node['sequence'] and n['toolName'] == node['toolName']]
            paired = matches[0] if len(matches) == 1 else None
            if paired:
                refs.append(reference(paired, 'arguments' if paired['arguments'] is not None else 'content'))
            else:
                codes.append('missing_or_ambiguous_tool_call')
            source = node['toolSource']
            if source == 'unknown':
                codes.append('unknown_tool_source')
                continue
            content = serialize({'success': False, 'error': node['error']}) if has_error else node['content']
            _, _, flat = failure_envelope(content)
            if source == 'builtin':
                rule = classify_builtin(node['toolName'] or '', content, flat, paired['arguments'] if paired else '')
            else:
                rule = classify_external(node['toolName'] or '', content, flat, source)
            category, summary = rule[0], rule[1]
        elif has_error:
            error_text = serialize(node['error'])
            for cat, label, _, _, pattern in PROVIDER_CONTRACTS:
                if re.search(pattern, error_text, re.I | re.S):
                    category, summary = cat, label
                    break
            if category is None:
                codes.append('unclassified_runtime_error')
        if category:
            require(category in CATEGORIES, 'Rule produced invalid category')
            observations.append({'category': category, 'moduleId': None, 'claimLevel': 'observation', 'summary': summary + ' (observed failure; causal owner unconfirmed)', 'evidenceRefs': refs})
    diagnosis = result['diagnosis']
    if observations:
        diagnosis.update(status='needs_review', category=observations[0]['category'] if len({x['category'] for x in observations}) == 1 else None, summary='Failure signals observed; evidence does not establish the originating responsible module', evidenceRefs=observations[0]['evidenceRefs'])
        codes.append('causal_owner_unconfirmed')
    else:
        codes.append('no_supported_failure_signal')
    if not payload['coverage']['complete']:
        codes.append('incomplete_source_coverage')
    diagnosis['reasonCodes'] = sorted(set(codes))
    return result


def analyze_reviewed(payload):
    """Keep pure rule observations, then attach an independent evidence gate."""
    from evidence_review import audited_candidate
    result = analyze(payload)
    audited = audited_candidate(payload, result['diagnosis'])
    result['review'] = audited['review']
    if audited['safeCandidate'] is not None:
        result['diagnosis'] = audited['safeCandidate']
    elif result['review']['existence']['status'] == 'invalid' or result['review']['support']['status'] == 'insufficient':
        diagnosis = result['diagnosis']
        diagnosis.update(status='needs_review' if result['observations'] else 'unknown', moduleId=None)
        diagnosis['reasonCodes'] = sorted(set(diagnosis['reasonCodes'] + ['evidence_review_not_supported']))
    return result


def failed_result(payload, code, message):
    result = base_result(payload if isinstance(payload, dict) else {})
    result['jobExecution'] = {'status': 'failed', 'errors': [{'code': code, 'message': message}]}
    result['diagnosis'].update(status='error', summary='Analyzer failed; no business result inferred', reasonCodes=[code])
    result['review'] = {'existence': {'status': 'not_applicable', 'issues': []}, 'support': {'status': 'not_applicable', 'issues': []}}
    return result


def main():
    payload = {}
    try:
        data = sys.stdin.buffer.read(MAX_BYTES + 1)
        require(len(data) <= MAX_BYTES, 'Input exceeds 1 MiB')
        payload = json.loads(data.decode('utf-8'), parse_constant=lambda _: (_ for _ in ()).throw(ContractError('Nonfinite JSON number')))
        result = analyze_reviewed(payload)
        exit_code = 0
    except (ContractError, ValueError, TypeError, KeyError, RecursionError):
        result = failed_result(payload, 'invalid_input', 'Input failed version, size, shape or value validation')
        exit_code = 1
    except Exception:
        result = failed_result(payload, 'analyzer_error', 'Unexpected analyzer failure')
        exit_code = 1
    sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False) + '\n')
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())

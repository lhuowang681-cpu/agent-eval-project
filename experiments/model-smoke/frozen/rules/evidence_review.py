"""Conservative evidence gate. Candidate text is untrusted, never a source of facts."""
import json
import re
from rules_pure import PROVIDER_CONTRACTS, failure_envelope, classify_builtin, classify_external

MODULE_IDS = frozenset(f'L{layer}.{leaf}' for layer, count in [(1,3),(2,5),(3,5),(4,7),(5,9),(6,8),(7,10),(8,9)] for leaf in range(1, count+1))
FIELDS = {'content', 'arguments', 'error'}


def issue(code, message, node_id=None):
    return {'code': code, 'nodeId': node_id, 'message': message}


def text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def observed_category(node):
    error = node['error'] not in (None, {}, [], '', False, 0)
    if node['role'] == 'tool':
        content = text({'success': False, 'error': node['error']}) if error else node['content']
        failed, _, flat = failure_envelope(content)
        if not failed or node['toolSource'] == 'unknown':
            return None
        if node['toolSource'] == 'builtin':
            return classify_builtin(node['toolName'] or '', content, flat, '')[0]
        return classify_external(node['toolName'] or '', content, flat, node['toolSource'])[0]
    if node['role'] in {'assistant', 'error'} and error:
        return next((cat for cat, _, _, _, pattern in PROVIDER_CONTRACTS if re.search(pattern, text(node['error']), re.I | re.S)), None)
    return None


def review_candidate(payload, candidate):
    """Accept a diagnosis-shaped candidate; return independent presence/support results.

    Semantic root-owner claims deliberately remain unsupported with today's DB-only
    contract. A real failure observation can pass; it does not prove upstream cause.
    """
    from adapter import CATEGORIES, validate, ContractError, analyze
    existence = {'status': 'not_applicable', 'issues': []}
    support = {'status': 'not_applicable', 'issues': []}
    result = {'existence': existence, 'support': support}
    try:
        validate(payload)
    except (ContractError, TypeError, ValueError):
        existence.update(status='invalid', issues=[issue('invalid_source_contract', 'Source request is invalid')])
        support.update(status='insufficient')
        return result
    if not isinstance(candidate, dict):
        existence.update(status='invalid', issues=[issue('invalid_candidate', 'Candidate must be an object')])
        support.update(status='insufficient')
        return result
    category = candidate.get('category')
    module = candidate.get('moduleId')
    level = candidate.get('claimLevel')
    refs = candidate.get('evidenceRefs')
    allowed = {'status', 'category', 'moduleId', 'claimLevel', 'summary', 'evidenceRefs', 'reasonCodes'}
    for identity in ['scope', 'trajectoryId', 'inputDigest']:
        if identity in candidate and candidate[identity] != payload.get(identity):
            existence['issues'].append(issue('cross_scope_candidate', 'Candidate identity differs from the trusted source trajectory'))
    if set(candidate) - allowed:
        support['issues'].append(issue('unsupported_candidate_fields', 'Candidate contains fields that cannot override source facts'))
    status = candidate.get('status')
    if not isinstance(status, str) or status not in {'resolved', 'unknown', 'needs_review', 'error'}:
        support['issues'].append(issue('invalid_status', 'Diagnosis status is outside the fixed dictionary'))
    reasons = candidate.get('reasonCodes')
    if not isinstance(reasons, list) or not all(isinstance(value, str) for value in reasons):
        support['issues'].append(issue('invalid_reason_codes', 'Reason codes must be a string array'))
    if category is not None and (not isinstance(category, str) or category not in CATEGORIES):
        support['issues'].append(issue('invalid_category', 'Category is outside the fixed rule dictionary'))
    if module is not None and (not isinstance(module, str) or module not in MODULE_IDS):
        support['issues'].append(issue('invalid_module', 'Module is outside the fixed 56-module dictionary'))
    if not isinstance(level, str) or level not in {'observation', 'root_cause'} or not isinstance(candidate.get('summary'), str):
        support['issues'].append(issue('invalid_claim', 'Claim shape or level is invalid'))
    if not isinstance(refs, list) or len(refs) > 500:
        existence.update(status='invalid', issues=[issue('invalid_references', 'Evidence references must be a bounded array')])
        support.update(status='insufficient')
        return result
    if not refs:
        if category or module or level == 'root_cause' or candidate.get('status') == 'resolved':
            support.update(status='insufficient')
            support['issues'].append(issue('missing_evidence', 'A conclusion needs cited evidence'))
        elif support['issues']:
            support.update(status='insufficient')
        if existence['issues']:
            existence['status'] = 'invalid'
            support['status'] = 'insufficient'
        return result
    nodes = {n['id']: n for n in payload['nodes']}
    existence['status'] = 'valid'
    cited = []
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get('nodeId'), str) or not isinstance(ref.get('field'), str) or ref.get('field') not in FIELDS or not isinstance(ref.get('quote'), str):
            existence['issues'].append(issue('invalid_reference', 'Reference shape or field is invalid'))
            continue
        node = nodes.get(ref['nodeId'])
        if node is None:
            existence['issues'].append(issue('missing_evidence_node', 'Node is absent from this trajectory scope', ref['nodeId']))
            continue
        if not ref['quote'] or ref['quote'] not in text(node[ref['field']]):
            existence['issues'].append(issue('quote_mismatch', 'Quote does not occur in the cited original field', ref['nodeId']))
            continue
        cited.append((node, ref['field']))
    if existence['issues']:
        existence['status'] = 'invalid'
    support['status'] = 'insufficient'
    if existence['status'] != 'valid':
        support['issues'].append(issue('invalid_evidence', 'Missing or mismatched evidence cannot support a conclusion'))
        return result
    if level == 'root_cause' or module is not None:
        support['issues'].append(issue('root_cause_chain_not_available', 'Failure exposure alone does not prove the originating responsible module'))
        return result
    matches = [n for n, field in cited if field in {'error', 'content'} and observed_category(n) == category and category is not None]
    if not matches:
        support['issues'].append(issue('failure_claim_not_supported', 'Cited original fields do not support this failure category'))
        return result
    trusted = analyze(payload)
    summaries = {trusted['diagnosis']['summary']} | {observation['summary'] for observation in trusted['observations'] if observation['category'] == category}
    if candidate['summary'] not in summaries:
        support['issues'].append(issue('unverified_freeform_summary', 'A matching category does not validate a freeform causal statement'))
        return result
    if not payload['coverage']['complete']:
        support['issues'].append(issue('incomplete_source_coverage', 'Source coverage is incomplete'))
        return result
    if support['issues']:
        return result
    support['status'] = 'supported'
    return result


def audited_candidate(payload, candidate):
    """Return the review plus a whitelisted, bounded observation or no safe claim."""
    from adapter import analyze
    review = review_candidate(payload, candidate)
    safe = None
    if review['existence']['status'] == 'valid' and review['support']['status'] == 'supported':
        trusted = analyze(payload)['diagnosis']
        safe = {
            'status': 'needs_review', 'category': candidate['category'], 'moduleId': None,
            'claimLevel': 'observation', 'summary': trusted['summary'],
            'evidenceRefs': [{key: ref[key] for key in ['nodeId', 'field', 'quote']} for ref in candidate['evidenceRefs']],
            'reasonCodes': ['causal_owner_unconfirmed'],
        }
    return {'review': review, 'sourceDigest': payload.get('inputDigest', ''), 'scope': payload.get('scope', {}), 'safeCandidate': safe}

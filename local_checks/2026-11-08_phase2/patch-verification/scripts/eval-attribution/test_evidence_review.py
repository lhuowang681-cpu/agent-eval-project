import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest
import adapter
from evidence_review import review_candidate, audited_candidate
from test_adapter import payload, tools, node


def candidate(request):
    return adapter.analyze(request)['diagnosis']


class EvidenceReviewTests(unittest.TestCase):
    def test_reviewed_adapter_retains_observations_and_never_promotes_owner(self):
        request = payload(tools())
        original = adapter.analyze(request)
        reviewed = adapter.analyze_reviewed(request)
        self.assertEqual(reviewed['observations'], original['observations'])
        self.assertEqual(reviewed['diagnosis']['status'], 'needs_review')
        self.assertIsNone(reviewed['diagnosis']['moduleId'])
        self.assertEqual(reviewed['review']['existence']['status'], 'valid')
        self.assertEqual(reviewed['review']['support']['status'], 'supported')

    def test_safe_candidate_never_preserves_resolved_or_freeform_reasons(self):
        request = payload(tools())
        raw = {**candidate(request), 'status': 'resolved', 'reasonCodes': ['LLM_says_Internal_Bug']}
        result = audited_candidate(request, raw)
        self.assertEqual(result['safeCandidate']['status'], 'needs_review')
        self.assertIsNone(result['safeCandidate']['moduleId'])
        self.assertEqual(result['safeCandidate']['reasonCodes'], ['causal_owner_unconfirmed'])
        self.assertEqual(result['sourceDigest'], request['inputDigest'])
        self.assertEqual(result['scope'], request['scope'])

    def test_invalid_candidates_have_no_safe_payload(self):
        request = payload(tools())
        for changes in [{'moduleId': 'L99.1'}, {'category': 'invented'}, {'original_error_type': 'forged'}, {'toolSource': 'builtin'}, {'claimLevel': 'root_cause', 'moduleId': 'L2.2'}]:
            with self.subTest(changes=changes):
                self.assertIsNone(audited_candidate(request, {**candidate(request), **changes})['safeCandidate'])

    def test_explicit_cross_scope_identity_is_not_merely_supported_by_real_id(self):
        request = payload(tools())
        result = audited_candidate(request, {**candidate(request), 'scope': {**request['scope'], 'caseId': 'other-case'}})
        self.assertEqual(result['review']['existence']['status'], 'invalid')
        self.assertIsNone(result['safeCandidate'])

    def test_empty_evidence_root_claim_is_insufficient(self):
        request = payload()
        result = audited_candidate(request, {**candidate(request), 'claimLevel': 'root_cause', 'summary': 'Root cause established'})
        self.assertEqual(result['review']['support']['status'], 'insufficient')
        self.assertIsNone(result['safeCandidate'])

    def test_unknown_source_does_not_become_an_external_cause_under_review(self):
        request = payload(tools('unknown'))
        result = adapter.analyze_reviewed(request)
        self.assertEqual(result['diagnosis']['status'], 'unknown')
        self.assertIsNone(result['diagnosis']['category'])
        self.assertIsNone(result['diagnosis']['moduleId'])

    def test_review_cli_real_stdio_preserves_source_not_candidate_scope(self):
        request = payload(tools())
        before = copy.deepcopy(request)
        raw = {**candidate(request), 'moduleId': 'L2.2', 'claimLevel': 'root_cause'}
        cli = Path(__file__).with_name('review_cli.py')
        process = subprocess.run([sys.executable, '-E', '-s', '-X', 'utf8', str(cli)], input=json.dumps({'trajectory': request, 'candidate': raw}).encode(), capture_output=True, timeout=10)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(process.stdout.splitlines()), 1)
        result = json.loads(process.stdout)
        self.assertEqual(set(result), {'review', 'sourceDigest', 'scope', 'safeCandidate'})
        self.assertEqual(result['review']['existence']['status'], 'valid')
        self.assertEqual(result['review']['support']['status'], 'insufficient')
        self.assertIsNone(result['safeCandidate'])
        self.assertEqual(result['scope'], request['scope'])
        self.assertEqual(request, before)

    def test_review_cli_malformed_input_is_execution_failure_without_raw_leak(self):
        cli = Path(__file__).with_name('review_cli.py')
        for raw in [b'{broken-credential-placeholder', b' ' * (adapter.MAX_BYTES + 1), b'{"trajectory":NaN,"candidate":null}']:
            process = subprocess.run([sys.executable, '-E', '-s', '-X', 'utf8', str(cli)], input=raw, capture_output=True, timeout=10)
            self.assertEqual(process.returncode, 1)
            result = json.loads(process.stdout)
            self.assertIsNone(result['safeCandidate'])
            self.assertEqual(result['review']['existence']['status'], 'invalid')
            self.assertNotIn('credential-placeholder', process.stdout.decode())

    def test_valid_real_failure_observation_supported(self):
        request = payload(tools())
        review = review_candidate(request, candidate(request))
        self.assertEqual(review['existence']['status'], 'valid')
        self.assertEqual(review['support']['status'], 'supported')

    def test_existing_id_does_not_prove_root_cause(self):
        request = payload(tools())
        raw = {**candidate(request), 'moduleId': 'L2.2', 'claimLevel': 'root_cause', 'summary': 'Agent generated invalid params'}
        result = review_candidate(request, raw)
        self.assertEqual(result['existence']['status'], 'valid')
        self.assertEqual(result['support']['status'], 'insufficient')
        self.assertIn('root_cause_chain_not_available', [i['code'] for i in result['support']['issues']])

    def test_missing_node_rejected(self):
        request = payload(tools())
        raw = candidate(request)
        raw['evidenceRefs'][0]['nodeId'] = 'fabricated'
        result = review_candidate(request, raw)
        self.assertEqual(result['existence']['status'], 'invalid')
        self.assertEqual(result['support']['status'], 'insufficient')

    def test_quote_from_generated_envelope_rejected(self):
        rows = tools()
        rows[1].update(content='', error={'message': 'service unavailable'})
        request = payload(rows)
        raw = candidate(request)
        raw['evidenceRefs'][0]['quote'] = '{"success": false}'
        self.assertEqual(review_candidate(request, raw)['existence']['status'], 'invalid')

    def test_cross_scope_node_not_in_current_bundle_rejected(self):
        request = payload(tools())
        raw = candidate(request)
        raw['evidenceRefs'][0]['nodeId'] = 'case2-node'
        self.assertEqual(review_candidate(request, raw)['existence']['status'], 'invalid')

    def test_matching_quote_in_unrelated_success_node_does_not_support_failure(self):
        request = payload([node('success', content='{"success":true}', toolSource='mcp')])
        raw = {'status': 'resolved', 'category': 'external_tool_failure', 'moduleId': None, 'claimLevel': 'observation', 'summary': 'failure', 'evidenceRefs': [{'nodeId': 'success', 'field': 'content', 'quote': '{"success":true}'}], 'reasonCodes': []}
        review = review_candidate(request, raw)
        self.assertEqual(review['existence']['status'], 'valid')
        self.assertEqual(review['support']['status'], 'insufficient')

    def test_wrong_category_not_supported(self):
        request = payload(tools())
        raw = {**candidate(request), 'category': 'external_permission'}
        self.assertEqual(review_candidate(request, raw)['support']['status'], 'insufficient')

    def test_matching_category_cannot_launder_fabricated_summary(self):
        request = payload(tools())
        raw = {**candidate(request), 'status': 'resolved', 'summary': 'Agent definitely generated incorrect internal parameters'}
        result = review_candidate(request, raw)
        self.assertEqual(result['existence']['status'], 'valid')
        self.assertEqual(result['support']['status'], 'insufficient')
        self.assertIn('unverified_freeform_summary', [i['code'] for i in result['support']['issues']])

    def test_illegal_status_rejected(self):
        request = payload(tools())
        self.assertEqual(review_candidate(request, {**candidate(request), 'status': 'invented'})['support']['status'], 'insufficient')

    def test_illegal_dictionary_and_fact_override_rejected_without_source_mutation(self):
        request = payload(tools())
        before = copy.deepcopy(request)
        for extra in [{'category': 'new_random_category'}, {'moduleId': 'L99.9'}, {'original_error_type': 'fabricated'}, {'confidence': float('nan')}, {'badcase_kind': 'invented'}]:
            with self.subTest(extra=extra):
                review = review_candidate(request, {**candidate(request), **extra})
                self.assertEqual(review['support']['status'], 'insufficient')
        self.assertEqual(request, before)

    def test_incomplete_coverage_not_fully_supported(self):
        request = payload(tools())
        request['coverage']['complete'] = False
        self.assertEqual(review_candidate(request, candidate(request))['support']['status'], 'insufficient')

    def test_no_evidence_unknown_is_not_applicable(self):
        request = payload()
        review = review_candidate(request, candidate(request))
        self.assertEqual(review['existence']['status'], 'not_applicable')
        self.assertEqual(review['support']['status'], 'not_applicable')

    def test_untrusted_wrong_types_do_not_raise(self):
        request = payload(tools())
        for raw in [None, [], 'text', {**candidate(request), 'claimLevel': []}, {**candidate(request), 'evidenceRefs': [{'nodeId': 'result', 'field': [], 'quote': ''}]}, {**candidate(request), 'evidenceRefs': 123}]:
            with self.subTest(raw=raw):
                result = review_candidate(request, raw)
                self.assertEqual(result['support']['status'], 'insufficient')


if __name__ == '__main__':
    unittest.main(verbosity=2)

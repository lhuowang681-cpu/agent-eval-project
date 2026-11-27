import copy
import unittest
import adapter
from evidence_review import review_candidate
from test_adapter import payload, tools, node


def candidate(request):
    return adapter.analyze(request)['diagnosis']


class EvidenceReviewTests(unittest.TestCase):
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

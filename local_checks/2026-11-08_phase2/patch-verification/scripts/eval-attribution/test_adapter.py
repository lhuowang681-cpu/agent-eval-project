import ast
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
import adapter

HERE = Path(__file__).resolve().parent


def node(nid, role='tool', **values):
    return {'id': nid, 'role': role, 'content': '', 'sourcePointer': 'messages.' + nid, 'messageId': nid, 'parentId': None, 'toolCallId': None, 'toolSource': 'unknown', 'toolName': None, 'arguments': None, 'error': None, 'traceId': None, 'sequence': 0, 'createdAt': None, **values}


def payload(nodes=None):
    return {'schemaVersion': 1, 'trajectoryId': 'trajectory-1', 'inputDigest': 'digest', 'scope': {'runId': 'run-1', 'caseId': 'case-1', 'topicId': 'topic-1', 'threadId': None, 'operationId': None, 'traceIds': []}, 'nodes': nodes or [], 'evaluation': {'status': 'failed', 'score': 0, 'task': 'test', 'expected': 'yes', 'actual': 'no', 'criteria': None}, 'coverage': {'source': 'database_messages', 'complete': True, 'warnings': []}}


def tools(source='mcp', error='service unavailable'):
    return [node('call', 'call', toolCallId='call-1', toolName='orders', toolSource=source, arguments='{"id":1}', sequence=0), node('result', toolCallId='call-1', toolName='orders', toolSource=source, content=json.dumps({'success': False, 'message': error}), sequence=1)]


class AdapterTests(unittest.TestCase):
    def test_all_fourteen_existing_categories_remain_compatible(self):
        cases = [
            ('provider', 'maximum context length', 'context_window_exceeded'),
            ('provider', 'text content blocks must contain non-whitespace', 'provider_payload_invalid'),
            ('provider', 'thinking expected a boolean', 'thinking_type_invalid'),
            ('provider', 'No model specified', 'model_missing'),
            ('builtin', 'invalid_argument', 'builtin_tool_contract_invalid'),
            ('builtin', 'execution is disabled', 'builtin_tool_unavailable'),
            ('builtin', 'not valid json', 'builtin_result_parse_failed'),
            ('builtin', 'unexpected failure', 'builtin_tool_failure_unclassified'),
            ('mcp', 'permission denied', 'external_permission'),
            ('mcp', 'credential invalid', 'external_credential'),
            ('mcp', 'quota reached', 'external_quota'),
            ('mcp', 'request timed out', 'external_timeout'),
            ('mcp', 'bad gateway', 'external_transport'),
            ('plugin', 'unexpected failure', 'external_tool_failure'),
        ]
        actual = set()
        for source, message, category in cases:
            rows = [node('p', 'error', error={'message': message})] if source == 'provider' else tools(source, message)
            with self.subTest(category=category):
                result = adapter.analyze(payload(rows))
                self.assertEqual(result['observations'][0]['category'], category)
                actual.add(result['observations'][0]['category'])
        self.assertEqual(actual, adapter.CATEGORIES)

    def test_reused_pure_functions_have_verbatim_ast_and_original_hash(self):
        import rules_pure
        project = HERE.parents[4]
        provenance = json.loads((HERE / 'provenance.json').read_text())
        original = project / provenance['source']
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), rules_pure.SOURCE_SHA256)
        original_tree = ast.parse(original.read_text(encoding='utf-8'))
        copied_tree = ast.parse((HERE / 'rules_pure.py').read_text(encoding='utf-8'))
        original_funcs = {n.name: ast.dump(n) for n in original_tree.body if isinstance(n, ast.FunctionDef)}
        copied_funcs = {n.name: ast.dump(n) for n in copied_tree.body if isinstance(n, ast.FunctionDef)}
        for name in provenance['functions']:
            self.assertEqual(copied_funcs[name], original_funcs[name])

    def test_external_failure_is_observation_not_internal_cause(self):
        data = payload(tools())
        before = copy.deepcopy(data)
        result = adapter.analyze(data)
        self.assertEqual(data, before)
        self.assertEqual(result['diagnosis']['status'], 'needs_review')
        self.assertIsNone(result['diagnosis']['moduleId'])
        self.assertEqual(result['observations'][0]['category'], 'external_transport')
        self.assertEqual(result['scope'], data['scope'])
        self.assertEqual(result['inputDigest'], 'digest')

    def test_unknown_source_does_not_get_external_category(self):
        result = adapter.analyze(payload(tools('unknown')))
        self.assertIsNone(result['diagnosis']['category'])
        self.assertEqual(result['observations'], [])
        self.assertIn('unknown_tool_source', result['diagnosis']['reasonCodes'])

    def test_source_name_does_not_override_structured_source(self):
        rows = tools('builtin', 'invalid_argument: required field')
        for row in rows:
            row['toolName'] = 'orders____mcp'
        result = adapter.analyze(payload(rows))
        self.assertEqual(result['observations'][0]['category'], 'builtin_tool_contract_invalid')
        self.assertIsNone(result['diagnosis']['moduleId'])

    def test_true_error_reference_uses_original_not_generated_envelope(self):
        rows = tools()
        rows[1].update(content='unstructured text', error={'message': 'service unavailable'})
        result = adapter.analyze(payload(rows))
        ref = result['observations'][0]['evidenceRefs'][0]
        self.assertEqual(ref['field'], 'error')
        self.assertEqual(ref['quote'], '{"message": "service unavailable"}')
        self.assertNotIn('success', ref['quote'])

    def test_failed_evaluation_without_failure_signal_stays_unknown(self):
        result = adapter.analyze(payload([node('a', 'assistant', content='answer')]))
        self.assertEqual(result['diagnosis']['status'], 'unknown')
        self.assertEqual(result['jobExecution']['status'], 'completed')

    def test_prompt_error_words_are_not_failures(self):
        result = adapter.analyze(payload([node('s', 'system', content='Error: invalid_argument'), node('u', 'user', content='{"success":false}')]))
        self.assertEqual(result['observations'], [])

    def test_provider_contract_uses_error_field_only(self):
        result = adapter.analyze(payload([node('a', 'assistant', error={'errorType': 'BadRequest', 'message': 'No model specified'})]))
        self.assertEqual(result['observations'][0]['category'], 'model_missing')
        self.assertIsNone(result['diagnosis']['moduleId'])

    def test_scope_isolated_across_equal_call_ids(self):
        left, right = payload(tools()), payload(tools())
        right['scope']['caseId'] = 'case-2'
        self.assertEqual(len(adapter.analyze(left)['observations']), 1)
        self.assertEqual(len(adapter.analyze(right)['observations']), 1)

    def test_duplicate_ids_rejected(self):
        with self.assertRaises(adapter.ContractError):
            adapter.analyze(payload([node('a'), node('a')]))

    def test_invalid_shapes_and_nonfinite_scores_rejected(self):
        for field, value in [('schemaVersion', 2), ('nodes', [node(str(i)) for i in range(501)]), ('scope', {}), ('evaluation', {'status': 'failed', 'task': '', 'expected': None, 'actual': None, 'criteria': None, 'score': float('nan')})]:
            request = payload()
            request[field] = value
            with self.subTest(field=field), self.assertRaises(adapter.ContractError):
                adapter.analyze(request)

    def test_duplicate_call_and_dangling_parent_are_visible(self):
        rows = tools()
        rows.insert(1, {**rows[0], 'id': 'duplicate-call'})
        rows[-1]['parentId'] = 'missing-parent'
        result = adapter.analyze(payload(rows))
        self.assertIn('missing_or_ambiguous_tool_call', result['diagnosis']['reasonCodes'])
        self.assertIn('dangling_parent', result['diagnosis']['reasonCodes'])

    def test_stdio_is_single_json_without_credentials_or_logs(self):
        raw = json.dumps(payload(tools())).encode()
        proc = subprocess.run([sys.executable, str(HERE / 'adapter.py')], input=raw, capture_output=True, timeout=10)
        result = json.loads(proc.stdout)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(len(proc.stdout.splitlines()), 1)
        self.assertEqual(proc.stderr, b'')
        self.assertEqual(result['trajectoryId'], 'trajectory-1')

    def test_invalid_json_and_oversize_return_execution_error(self):
        for raw in [b'{broken', b' ' * (adapter.MAX_BYTES + 1), b'{"schemaVersion":NaN}']:
            proc = subprocess.run([sys.executable, str(HERE / 'adapter.py')], input=raw, capture_output=True, timeout=10)
            result = json.loads(proc.stdout)
            self.assertEqual(proc.returncode, 1)
            self.assertEqual(result['jobExecution']['status'], 'failed')
            self.assertEqual(result['diagnosis']['status'], 'error')
            self.assertNotIn('broken', result['jobExecution']['errors'][0]['message'])


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Run against original via ATTRIBUTION_MODULE, or maintained local copy by default."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(os.environ.get('ATTRIBUTION_MODULE', Path(__file__).with_name('structured_jsonl_attribution.py')))
spec = importlib.util.spec_from_file_location('attribution_under_test', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def call(cid, name='orders____mcp', args='{"id":1}'):
    return {'role': 'assistant', 'tool_calls': [{'id': cid, 'function': {'name': name, 'arguments': args}}]}


def result(cid, content):
    return {'role': 'tool', 'tool_call_id': cid, 'content': json.dumps(content)}


def trace(messages, tid='t1'):
    return {'id': tid, 'sessionId': 'session1', 'input': messages}


class AttributionRegression(unittest.TestCase):
    def scan(self, traces):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'part_001.jsonl').write_text('\n'.join(json.dumps(x) for x in traces), encoding='utf-8')
            return mod.scan(tmp)

    def failure(self):
        return [{'role': 'user', 'content': '查询订单'}, call('a'), result('a', {'success': False, 'error': 'service unavailable'})]

    def test_unrelated_tool_success_is_not_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [call('b', 'weather____mcp'), result('b', {'success': True})])])
        self.assertFalse(rows[0]['recovered'])

    def test_unstructured_nonfailure_is_not_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [call('b'), result('b', 'pending')])])
        self.assertFalse(rows[0]['recovered'])

    def test_different_arguments_are_not_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [call('b', args='{"id":2}'), result('b', {'ok': True})])])
        self.assertFalse(rows[0]['recovered'])

    def test_later_user_turn_is_not_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [{'role': 'user', 'content': '再次查询订单'}, call('b'), result('b', {'ok': True})])])
        self.assertFalse(rows[0]['recovered'])
        self.assertEqual(rows[0]['user_task'], '查询订单')

    def test_matching_retry_with_explicit_success_is_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [call('b', args='{ "id": 1 }'), result('b', {'status': 'succeeded'})])])
        self.assertTrue(rows[0]['recovered'])
        self.assertEqual(rows[0]['recovery_tool_call_id'], 'b')

    def test_contradictory_success_failure_is_not_recovery(self):
        rows, _ = self.scan([trace(self.failure() + [call('b'), result('b', {'success': True, 'isError': True})])])
        self.assertFalse(rows[0]['recovered'])

    def test_bad_line_is_quarantined_with_real_line_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'part_001.jsonl').write_text('\n{broken\n' + json.dumps(trace(self.failure())) + '\n', encoding='utf-8')
            rows, scope = mod.scan(tmp)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['source_line'], 3)
        self.assertEqual(scope['invalid_lines'], 1)
        self.assertEqual(scope['blank_lines'], 1)
        self.assertEqual(scope['input_errors'][0]['line'], 2)

    def test_non_object_row_is_quarantined(self):
        rows, scope = self.scan([[], trace(self.failure())])
        self.assertEqual(len(rows), 1)
        self.assertEqual(scope['invalid_lines'], 1)

    def test_duplicate_results_keep_event_and_topic_denominators(self):
        rows, scope = self.scan([trace(self.failure()), trace(self.failure(), 't2')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(scope['traces'], 2)
        self.assertEqual(scope['raw_failure_events'], 2)
        self.assertEqual(scope['duplicate_failure_events'], 1)

    def test_success_only_cli_writes_empty_csv_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            inp, out = Path(tmp, 'input'), Path(tmp, 'output')
            inp.mkdir()
            Path(inp, 'part_001.jsonl').write_text(json.dumps(trace([call('a'), result('a', {'success': True})])), encoding='utf-8')
            completed = subprocess.run([sys.executable, str(MODULE), '--input-dir', str(inp), '--output-dir', str(out)], capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads(Path(out, 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual(summary['failure_events'], 0)
            self.assertEqual(summary['input_traces'], 1)
            self.assertIn('actionability', Path(out, 'classified_all.csv').read_text(encoding='utf-8-sig'))


if __name__ == '__main__':
    unittest.main(verbosity=2)

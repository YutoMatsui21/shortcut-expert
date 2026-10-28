"""Contract tests for compact session reporting using synthetic rollouts."""
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from session_report import build_report, render_report, _command_summary


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'sample.jsonl'
        self.rows = []

    def add(self, kind, payload, second):
        self.rows.append({'timestamp': f'2026-10-28T08:00:{second:02d}Z', 'type': kind, 'payload': payload})

    def save(self):
        self.path.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in self.rows), encoding='utf-8')

    def fixture(self):
        self.add('session_meta', {'id': 'sample'}, 0)
        self.add('turn_context', {'model': 'gpt-6.1-terra'}, 0)
        self.add('event_msg', {'type': 'task_started', 'turn_id': 't1'}, 1)
        self.add('response_item', {'type': 'function_call', 'name': 'exec', 'call_id': 'a', 'arguments': '{"cmd":"first"}'}, 2)
        self.add('response_item', {'type': 'function_call_output', 'call_id': 'a', 'output': 'x' * 10000}, 3)
        self.add('token_usage_record', {'response_id': 'r1', 'turn_id': 't1', 'usage': {'input_tokens': 100, 'cached_input_tokens': 50, 'output_tokens': 10, 'total_tokens': 110}}, 4)
        self.add('token_usage_record', {'response_id': 'r1', 'turn_id': 't1', 'usage': {'input_tokens': 100, 'cached_input_tokens': 50, 'output_tokens': 10, 'total_tokens': 110}}, 4)
        self.add('event_msg', {'type': 'task_complete', 'turn_id': 't1', 'duration_ms': 5000}, 5)
        self.add('event_msg', {'type': 'task_started', 'turn_id': 't2'}, 6)
        self.add('response_item', {'type': 'function_call', 'name': 'exec', 'call_id': 'b', 'arguments': '{"cmd":"first"}'}, 7)
        self.add('response_item', {'type': 'function_call_output', 'call_id': 'b', 'output': 'Traceback (most recent call last):\nboom\noutput truncated'}, 9)
        self.add('token_usage_record', {'response_id': 'r2', 'turn_id': 't2', 'usage': {'input_tokens': 300, 'cached_input_tokens': 200, 'output_tokens': 20, 'total_tokens': 320}}, 10)
        self.add('event_msg', {'type': 'task_complete', 'turn_id': 't2', 'duration_ms': 6000}, 11)
        self.save()

    def test_usage_dedup_and_turns(self):
        self.fixture()
        report = build_report(self.path)
        self.assertEqual(report['tokens']['usage']['input_tokens'], 400)
        self.assertEqual(report['tokens']['noncached_input_tokens'], 150)
        self.assertEqual(report['tokens']['responses'], 2)
        self.assertEqual(report['tokens']['input_per_response']['first'], 100)
        self.assertEqual(report['tokens']['input_per_response']['last'], 300)
        self.assertEqual([t['tool_calls'] for t in report['turns']], [1,1])
        self.assertEqual([t['tokens']['input_tokens'] for t in report['turns']], [100,300])

    def test_candidates_and_evidence(self):
        self.fixture()
        report = build_report(self.path)
        self.assertEqual([c['id'] for c in report['candidates']['largest_outputs']], [1,2])
        self.assertEqual(report['tools']['suspected_failures'], 1)
        self.assertEqual(report['tools']['possible_truncations'], 1)
        self.assertEqual(report['candidates']['repeated'][0]['ids'], [1,2])
        self.assertEqual(report['candidates']['longest_calls'][0]['id'], 2)
        self.assertTrue(all('signature' not in x for x in report['candidates']['largest_outputs']))

    def test_early_output_and_turn_attribution(self):
        self.fixture()
        report = build_report(self.path)
        outputs = [10000, len('Traceback (most recent call last):\nboom\noutput truncated')]
        self.assertEqual(report['tools']['output_chars_total'], sum(outputs))
        self.assertEqual(report['output_timeline']['initial_window']['output_chars'], sum(outputs))
        self.assertEqual(report['output_timeline']['initial_window']['share_percent'], 100.0)
        self.assertEqual([t['tool_output_chars'] for t in report['turns']], outputs)
        self.assertEqual(report['output_timeline']['unattributed_chars'], 0)

    def test_output_windows_cover_calls_without_double_counting(self):
        self.add('session_meta', {'id': 'windows'}, 0)
        for i in range(10):
            self.add('response_item', {'type': 'function_call', 'name': 'exec',
                                       'call_id': str(i), 'arguments': '{"cmd":"x"}'}, 1)
            self.add('response_item', {'type': 'function_call_output',
                                       'call_id': str(i), 'output': 'a' * (3 if i < 8 else 10)}, 2)
        self.save()
        report = build_report(self.path)
        timeline = report['output_timeline']
        self.assertEqual(timeline['window_size_calls'], 8)
        self.assertEqual(timeline['window_count'], 2)
        self.assertEqual(timeline['initial_window']['from_id'], 1)
        self.assertEqual(timeline['initial_window']['to_id'], 8)
        self.assertEqual(timeline['initial_window']['output_chars'], 24)
        self.assertEqual(timeline['largest_windows'][1]['output_chars'], 20)
        self.assertEqual(report['tools']['output_chars_total'], 44)
        self.assertEqual(timeline['unattributed_chars'], 44)

    def test_short_summaries_extract_wrapped_commands(self):
        wrapped = 'const r = await tools.exec_command({cmd:"Get-Content src/main/observer.ts; rg -n foo ."});'
        self.assertIn('Get-Content src/main/observer.ts', _command_summary('exec', wrapped))
        self.assertNotIn('const r', _command_summary('exec', wrapped))
        self.assertEqual(_command_summary('exec', 'tools.write_stdin({session_id:42})'),
                         '実行中プロセスの待機・出力取得')
        self.assertNotIn('sk-secret123', _command_summary('exec', '{"cmd":"echo sk-secret123"}'))
        self.fixture()
        report = build_report(self.path)
        self.assertEqual(report['candidates']['largest_outputs'][0]['summary'], 'first')

    def test_bounded_json_and_omissions(self):
        self.fixture()
        full = build_report(self.path)
        for limit in (800, 1200, 2000, 6000):
            encoded = render_report(full, limit)
            self.assertLessEqual(len(encoded), limit)
            obj = json.loads(encoded)
            self.assertEqual(obj.get('session', {}).get('id', obj.get('session_id')), 'sample')
            self.assertIn('truncated', obj)
        small = json.loads(render_report(full, 1200))
        self.assertTrue(small['truncated'])
        self.assertIn('omitted', small)

    def test_fallback_counts_not_assigned_to_turns(self):
        self.add('session_meta', {'id': 'fallback'}, 0)
        self.add('event_msg', {'type': 'token_count', 'info': {'total_token_usage': {'input_tokens': 123, 'cached_input_tokens': 23, 'output_tokens': 9, 'total_tokens': 132}}}, 1)
        self.save()
        report=build_report(self.path)
        self.assertEqual(report['tokens']['usage']['input_tokens'], 123)
        self.assertEqual(report['tokens']['source'], 'token_count.total_token_usage')
        self.assertEqual(report['tokens']['responses'], 0)

    def test_cli_report_returns_bounded_json(self):
        self.fixture()
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('analyze_session.py')),
             'report', '--file', str(self.path), '--top', '2',
             '--max-total-chars', '1200'],
            capture_output=True, text=True, encoding='utf-8', check=True,
        )
        self.assertLessEqual(len(proc.stdout.strip()), 1200)
        result = json.loads(proc.stdout)
        self.assertEqual(result.get('session', {}).get('id', result.get('session_id')), 'sample')
        self.assertTrue(result['truncated'])

    def test_oversized_row_is_not_echoed(self):
        self.fixture()
        output = render_report(build_report(self.path), 6000)
        self.assertNotIn('x' * 100, output)
        self.assertNotIn('Traceback (most recent call last)', output)


if __name__ == '__main__':
    unittest.main()

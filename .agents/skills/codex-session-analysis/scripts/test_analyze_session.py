"""Regression tests for the staged rollout inspector (standard library only)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import analyze_session as analysis


class SessionAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "rollout-test.jsonl"
        rows = [
            ("session_meta", {"id": "fixture-session", "cwd": "fixture"}),
            ("event_msg", {"type": "agent_message", "message": "前のメッセージ"}),
            ("response_item", {"type": "function_call", "name": "exec",
                               "call_id": "call-1", "arguments": '{"cmd":"echo 日本語"}'}),
            ("response_item", {"type": "function_call_output", "call_id": "call-1",
                               "output": "日本語" + "あ" * 10000}),
            ("event_msg", {"type": "agent_message", "message": "後のメッセージ"}),
            ("response_item", {"type": "function_call", "name": "exec",
                               "call_id": "call-2", "arguments": '{"cmd":"python broken.py"}'}),
            ("response_item", {"type": "function_call_output", "call_id": "call-2",
                               "output": "Traceback (most recent call last):\n  line 1\nUnicodeEncodeError: sample"}),
        ]
        self.path.write_text(
            "".join(json.dumps({"timestamp": f"2026-10-28T08:53:{i:02d}Z",
                                "type": kind, "payload": payload},
                               ensure_ascii=False) + "\n"
                    for i, (kind, payload) in enumerate(rows)),
            encoding="utf-8",
        )

    def test_around_zero_has_no_surrounding_messages(self):
        result = analysis.detail(self.path, 1, 0, 2000)
        self.assertEqual(result["context_before"], [])
        self.assertEqual(result["context_after"], [])
        self.assertEqual(result["nearby_calls"], [])

    def test_total_limit_preserves_valid_json_and_reports_omissions(self):
        result = analysis.detail(self.path, 1, 3, 2000)
        output = analysis.render_detail(result, 1000)
        parsed = json.loads(output)
        self.assertLessEqual(len(output), 1000)
        self.assertEqual(parsed["tool"]["id"], 1)
        self.assertTrue(parsed["truncated"])
        self.assertTrue(parsed["omitted_fields"])

    def test_filter_and_sort_calls(self):
        _, calls, _ = analysis.read_rollout(self.path)
        selected = analysis.select_calls(calls, min_output_chars=1000, sort_by="output")
        self.assertEqual([c["id"] for c in selected], [1])
        selected = analysis.select_calls(calls, min_elapsed_s=0.5, sort_by="duration")
        self.assertEqual([c["id"] for c in selected], [1, 2])

    def test_traceback_is_reported_separately_from_exit_code(self):
        overview = analysis.overview(self.path)
        self.assertEqual(overview["nonzero_exits"], 0)
        self.assertEqual(overview["suspected_failures"], 1)
        self.assertEqual(overview["tool_calls"], 2)

    def test_cli_emits_utf8_even_with_non_utf8_stdout_environment(self):
        env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        proc = subprocess.run(
            [sys.executable, str(Path(analysis.__file__)), "detail",
             "--file", str(self.path), "--id", "1",
             "--around", "0", "--max-total-chars", "4500"],
            capture_output=True, env=env, check=True,
        )
        self.assertIn("日本語", json.loads(proc.stdout.decode("utf-8"))["output"])
        self.assertLessEqual(len(proc.stdout.decode("utf-8")), 4500)


if __name__ == "__main__":
    unittest.main()

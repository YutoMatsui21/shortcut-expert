"""指定行のメッセージ抽出とツールID絞り込みの回帰テスト。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import analyze_session as analysis


class MessageAndCallsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / "rollout.jsonl"
        rows = [
            ("session_meta", {"id": "sample"}),
            ("response_item", {"type": "message", "role": "assistant", "content": [
                {"type": "output_text", "text": "原因は–既存経路にあります。"},
                {"type": "output_text", "text": "追加検証が必要です。"},
                {"type": "image", "data": "秘密の生データ"}]}),
            ("event_msg", {"type": "agent_message", "message": "調査を続けます。"}),
            ("response_item", {"type": "function_call", "name": "exec", "call_id": "a", "arguments": '{"cmd":"echo one"}'}),
            ("response_item", {"type": "function_call_output", "call_id": "a", "output": "secret output"}),
            ("response_item", {"type": "function_call", "name": "exec", "call_id": "b", "arguments": '{"cmd":"echo two"}'}),
            ("response_item", {"type": "function_call_output", "call_id": "b", "output": "second"}),
            ("response_item", {"type": "function_call", "name": "exec", "call_id": "c", "arguments": '{"cmd":"echo three"}'}),
            ("response_item", {"type": "function_call_output", "call_id": "c", "output": "third"}),
            ("response_item", {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "質問本文"}]}),
        ]
        self.file.write_text("".join(
            json.dumps({"timestamp": f"2026-10-28T10:00:{i:02d}Z",
                        "type": kind, "payload": payload}, ensure_ascii=False) + "\n"
            for i, (kind, payload) in enumerate(rows, 1)), encoding="utf-8")

    def run_cli(self, *args, env=None, check=True):
        return subprocess.run(
            [sys.executable, str(Path(analysis.__file__)), *args],
            capture_output=True, env=env, check=check)

    def test_assistant_output_text_extraction(self):
        result = analysis.message_at_line(self.file, 2, 1500)
        self.assertEqual(result["role"], "assistant")
        self.assertIn("原因は–既存経路", result["text"])
        self.assertIn("追加検証", result["text"])
        self.assertNotIn("秘密の生データ", result["text"])
        self.assertFalse(result["truncated"])
        self.assertEqual(result["line"], 2)

    def test_event_and_user_messages(self):
        self.assertEqual(analysis.message_at_line(self.file, 3, 1500)["text"], "調査を続けます。")
        self.assertEqual(analysis.message_at_line(self.file, 10, 1500)["text"], "質問本文")

    def test_non_message_line_is_rejected_without_dumping_tool_output(self):
        proc = self.run_cli("message", "--file", str(self.file), "--line", "5", check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertNotIn(b"secret output", proc.stdout + proc.stderr)

    def test_text_limit_preserves_json_and_utf8(self):
        env = {**os.environ, "PYTHONIOENCODING": "cp932"}
        proc = self.run_cli("message", "--file", str(self.file), "--line", "2",
                            "--max-chars", "8", env=env)
        result = json.loads(proc.stdout.decode("utf-8"))
        self.assertTrue(result["truncated"])
        self.assertLessEqual(len(result["text"]), 9)  # truncated marker
        self.assertEqual(result["role"], "assistant")

    def test_calls_id_and_range_filters_preserve_original_ids(self):
        _, calls, _ = analysis.read_rollout(self.file)
        self.assertEqual([x["id"] for x in analysis.select_calls(calls, ids={1, 3})], [1, 3])
        self.assertEqual([x["id"] for x in analysis.select_calls(calls, from_id=2, to_id=3)], [2, 3])
        self.assertEqual([x["id"] for x in analysis.select_calls(calls, ids={1, 3}, from_id=2)], [3])

    def test_cli_calls_ids_and_invalid_range(self):
        proc = self.run_cli("calls", "--file", str(self.file), "--ids", "3,1", "--limit", "10")
        lines = [json.loads(x) for x in proc.stdout.decode("utf-8").splitlines()]
        self.assertEqual([x["id"] for x in lines[:-1]], [1, 3])
        self.assertEqual(lines[-1]["matched_calls"], 2)
        invalid = self.run_cli("calls", "--file", str(self.file),
                               "--from-id", "3", "--to-id", "2", check=False)
        self.assertNotEqual(invalid.returncode, 0)

    def test_existing_calls_output_unchanged_by_default(self):
        proc = self.run_cli("calls", "--file", str(self.file), "--limit", "10")
        lines = [json.loads(x) for x in proc.stdout.decode("utf-8").splitlines()]
        self.assertEqual([x["id"] for x in lines[:-1]], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()

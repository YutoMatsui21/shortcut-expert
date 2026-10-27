---
name: codex-session-analysis
description: Analyze one or more Codex rollout JSONL sessions to identify unnecessary tool calls, repeated work, oversized outputs, rework, and token inefficiency. Use for session retrospectives; do not run automatically after every task.
---

# Codex session analysis

The source of truth is the local rollout JSONL. Never paste whole rollouts into the model context. Use the bundled script to progressively retrieve compact metadata and targeted evidence.

1. Locate the target session(s) using:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py overview --last 5 --project .`
2. For sessions worth investigating, inspect tool call metadata in small pages:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py calls --file "<rollout path>" --limit 50`
3. Choose likely waste candidates yourself, based on repeated calls, output size, failures, or unnecessary work. Do **not** equate repeated calls with proven waste.
4. Pull only relevant evidence:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py detail --file "<rollout path>" --id 7 --around 3 --max-chars 2000`
5. Trace what happened between candidate calls. Decide whether each operation was actually needed. Report evidence by session path, tool ID, and source line number.
6. Recommend narrowly scoped changes and explain expected impact and uncertainty. Distinguish measured tokens from output character counts and tool call-to-result latency approximations.
7. For multi-session review, compare overviews first. Avoid summing resumption/replayed records without deduplicating by response ID, and include sub-agent rollouts when the user's requested scope requires them.

Read-only. Do not modify logs, code, AGENTS.md, or other Skills as part of analysis unless explicitly requested. Do not copy session logs into the public repository; logs may contain code, prompts, and secrets. For precise API/internal latency analysis, inspect OTel data separately if available.

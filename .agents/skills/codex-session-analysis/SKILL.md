---
name: codex-session-analysis
description: Analyze one or more Codex rollout JSONL sessions to identify unnecessary tool calls, repeated work, oversized outputs, rework, and token inefficiency. Use for session retrospectives; do not run automatically after every task.
---

# Codex session analysis

The source of truth is the local rollout JSONL. Never paste whole rollouts into the model context. Use the bundled script to retrieve compact metadata, then only the evidence needed to decide whether work was wasteful.

1. **Locate the target session.** Start with:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py overview --last 5 --project .`
   Once identified, keep its exact path; do not rerun broad session searches without a new reason.
2. **Inspect compact call metadata.** Use small pages, normally up to 50 entries:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py calls --file "<rollout path>" --limit 50`
   To find likely bottlenecks without expanding every call, use targeted filters and rankings:
   - Largest outputs: `calls --file "<rollout path>" --sort-by output --limit 10`
   - Slowest calls: `calls --file "<rollout path>" --sort-by duration --limit 10`
   - Output threshold: `calls --file "<rollout path>" --min-output-chars 10000 --limit 20`
   IDs and source line numbers refer to the original rollout order, even when filtered or sorted.
3. **Choose candidates.** Consider repeated calls, excessive output, errors, rework, and context. Large or repeated calls are leads, not proof of waste.
4. **Fetch narrowly scoped evidence.** For one selected call:
   `python .agents/skills/codex-session-analysis/scripts/analyze_session.py detail --file "<rollout path>" --id 7 --around 2 --max-chars 2000 --max-total-chars 6000`
   Use `--around 0` when surrounding conversation is unnecessary. Total output is capped per detail call; its JSON reports omitted fields. Do not batch many detail calls into one large tool response. Re-fetch the same ID only when specific additional context is needed.
5. **Trace necessity and causality.** Check what happened between candidate calls. Decide whether each was actually needed; report evidence using session path, tool ID, and source line number. `nonzero_exits` counts only recognized explicit exit codes; `suspected_failures` is a separate signal (currently Python tracebacks), not a confirmed exit-status count.
6. **Recommend focused changes.** Explain likely impact and uncertainty. Distinguish measured tokens, output characters, and call-to-result latency approximations.
7. **Compare multiple sessions if requested.** Compare overviews first. Avoid summing resumption/replayed token records without deduplicating by response ID. Include sub-agent rollouts when the scope requires them.

Read-only. Do not modify logs, code, AGENTS.md, or other Skills as part of an analysis unless explicitly requested. Do not copy session logs into the public repository; they may contain code, prompts, and secrets. For precise API/internal latency analysis, inspect OTel separately if available.

For script changes, run the standard-library regression tests:
`python -m unittest discover -s .agents/skills/codex-session-analysis/scripts -p "test_*.py"`

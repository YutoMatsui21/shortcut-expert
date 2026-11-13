import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, mock } from "node:test";
import { dotnet, dotnetEnvironment } from "../../scripts/dev/dotnet.mjs";
import { classify, classifyGesture } from "../../src/core/detector.ts";
import { DurableCoach } from "../../src/core/durable-coach.ts";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
import { windowDiagnosticKeys } from "../../src/shared/window-diagnostics.ts";
import { v2Fixture, type Candidate } from "../support/fixtures.ts";

mock.module("electron", { namedExports: { app: {} } });
const { candidateV2, parseObserverMessage } =
  await import("../../src/main/observer.ts");

test(
  "本番のC#候補生成と全画面分類を人工イベント列で検証する",
  { timeout: 60_000 },
  async (t) => {
    const result = spawnSync(
      dotnet,
      [
        "run",
        "--project",
        "tests/native/policy/WindowObserver.PolicyTests.csproj",
        "--configuration",
        "Release",
        "--verbosity",
        "quiet",
      ],
      {
        env: dotnetEnvironment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 55_000,
        maxBuffer: 262_144,
      },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
    assert.equal(report.globalInputCollected, false);
    // Fixed at main 8dbb7d6: production candidates, not the experiment's composer.
    // Arrays preserve emission order; complete envelopes preserve route/evidence.
    const baseline = JSON.parse(
      readFileSync(
        new URL("../fixtures/detection-baseline-v2.json", import.meta.url),
        "utf8",
      ),
    );
    // Invocation is the sole legacy adapter using the wall-clock date. Compare
    // its date separately so the fixed baseline does not expire at midnight.
    const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
    for (const candidate of report.snapSamples) {
      assert.equal(candidate.date, today);
      candidate.date = baseline.snapSamples[0].date;
    }
    for (const key of Object.keys(baseline).filter(
      (key) => key !== "independence",
    ))
      assert.deepEqual(
        report[key],
        baseline[key],
        `current v2 baseline: ${key}`,
      );
    assert.deepEqual(
      report.independence.rows.map(
        (row: { name: string; expected: string[]; baseline: unknown }) => ({
          name: row.name,
          expected: row.expected,
          baseline: row.baseline,
        }),
      ),
      baseline.independence,
      "49 named current-production fixture outcomes",
    );
    await t.test(
      "target specification ONLY: confirmed W02 survives an invalid W03/W07 terminal",
      () => {
        // This checks the isolated design experiment, NOT a production partial-adoption path.
        for (const name of ["invalid-max-release", "invalid-quarter-release"]) {
          const row = report.independence.rows.find(
            (row: { name: string }) => row.name === name,
          );
          assert.ok(row, name);
          assert.equal(row.baseline, null, "current production emits nothing");
          assert.deepEqual(
            row.expected,
            [],
            "current expectation stays unchanged",
          );
          assert.deepEqual(
            row.independent,
            ["W02"],
            "target independent evidence",
          );
        }
      },
    );
    assert.deepEqual(
      report.windowDiagnosticKeys,
      [...windowDiagnosticKeys],
      "native reason taxonomy and Main allowlist must stay synchronized",
    );
    assert.ok(
      report.passed.length > 0,
      "Native policy suite must not silently discover zero tests",
    );
    t.diagnostic(`C# production policy assertions: ${report.passed.length}`);
    // These lines are produced by the production C# Evidence serializer. Check
    // the wire before parsing as well as the normalized TS result.
    assert.ok(report.independentResultSamples.length >= 3);
    const independent = report.independentResultSamples.map((line: string) => {
      const raw: unknown = parseObserverMessage(line);
      const parsed = candidateV2(raw);
      assert.ok(parsed, "C# independent-results JSON must satisfy TS contract");
      assert.equal(parsed.evidence.kind, "independent-results");
      const forbidden =
        /"(?:operation|shortcut|hwnd|pid|title|url|path|clipboard|keys|inputTimes|generationId|targetIdentity)"\s*:/i;
      assert.equal(
        forbidden.test(line),
        false,
        "raw C# JSONL has no forbidden fields",
      );
      assert.equal(forbidden.test(JSON.stringify(parsed)), false);
      return parsed;
    });
    for (const [index, count] of [1, 2, 3].entries()) {
      const evidence = independent[index].evidence;
      assert.equal(evidence.kind, "independent-results");
      if (evidence.kind === "independent-results")
        assert.equal(evidence.results.length, count);
    }
    const observations = report.samples.map((sample: Candidate) => {
      const parsed = candidateV2(v2Fixture(sample));
      assert.ok(parsed, "internal C# sample must satisfy TS v2 protocol");
      return classify(parsed);
    });
    assert.equal(observations[0]?.origin, "mouse");
    assert.equal(observations[0]?.shortcut, "Win + ↑");
    assert.equal(observations[1]?.origin, "key");
    assert.deepEqual(
      observations.slice(2, 4),
      [null, null],
      "Injected input is not a counted operation",
    );
    assert.deepEqual(
      observations
        .slice(4)
        .map((value: ReturnType<typeof classify>) => [
          value?.operation,
          value?.origin,
        ]),
      ["mouse", "key"].flatMap((origin) =>
        ["W04", "W04", "W11", "W02"].map((id) => [id, origin]),
      ),
    );
    const v2 = report.v2Samples.map((sample: unknown) => {
      const parsed = candidateV2(sample);
      assert.ok(parsed, "C# v2 output must satisfy strict TS protocol");
      return classify(parsed);
    });
    assert.deepEqual(
      v2
        .slice(0, observations.length)
        .map(
          (value: ReturnType<typeof classify>) =>
            value && { ...value, id: "comparison" },
        ),
      observations.map(
        (value: ReturnType<typeof classify>) =>
          value && { ...value, id: "comparison" },
      ),
    );
    assert.deepEqual(v2.slice(observations.length), [null, null, null]);
    assert.deepEqual(
      report.snapSamples.map((sample: unknown) => {
        const parsed = candidateV2(sample);
        assert.ok(parsed, "historical C# evidence still parses");
        return classify(parsed);
      }),
      [null, null],
      "W08 is excluded from the eight-operation release",
    );
    assert.deepEqual(
      report.taskbarSamples.map((sample: unknown) => {
        const parsed = candidateV2(sample);
        assert.ok(parsed);
        const observed = classify(parsed);
        assert.ok(observed);
        return [observed.operation, observed.origin, observed.shortcut];
      }),
      [
        ["W12", "mouse", "Win + 0"],
        ["W12", "key", "Win + 1"],
      ],
    );
    assert.deepEqual(
      report.switchSamples.map((sample: unknown) => {
        const parsed = candidateV2(sample);
        assert.ok(parsed);
        const observed = classify(parsed);
        assert.ok(observed);
        assert.equal(JSON.stringify(parsed).includes("Handle"), false);
        return [observed.operation, observed.origin, observed.shortcut];
      }),
      [
        ["W01", "mouse", "Alt + Tab"],
        ["W01", "key", "Alt + Tab"],
      ],
    );

    const root = await mkdtemp(join(tmpdir(), "coach-native-state-"));
    const repository = new SqliteRepository(
      root,
      resolve("src/main/storage-worker.ts"),
    );
    t.after(async () => {
      await repository.close();
      await rm(root, { recursive: true, force: true });
    });
    const totals: Record<string, { mouse: number; key: number }> = {};
    const deliveries: Promise<void>[] = [];
    let notices = 0,
      expectedNotices = 0;
    const coach = new DurableCoach({
      repository,
      session: repository.session,
      date: () => "2026-10-28",
      now: () => 0,
      capabilities: () => [],
      changed: () => {},
      notify: (notice) => {
        const expected = { ...totals[notice.operation] };
        const delivery = repository
          .query("2026-10-28", "2026-10-28")
          .then((saved) => {
            assert.deepEqual(
              saved.counts["2026-10-28"][notice.operation],
              expected,
              "SQLite commits before notification",
            );
            notices++;
          });
        deliveries.push(delivery);
        return delivery.then(() => true);
      },
    });
    await coach.initialize();
    coach.begin(1);
    for (const entry of [
      ...report.windowStateSamples,
      ...report.placementSamples,
      ...report.monitorMoveSamples,
      ...report.closeSamples,
    ]) {
      const parsed = candidateV2(entry.candidate);
      assert.ok(parsed, "new C# state evidence satisfies strict v2 parse");
      const observation = classify(parsed);
      assert.equal(observation?.operation ?? null, entry.expected);
      if (observation) {
        const counts = (totals[observation.operation] ??= { mouse: 0, key: 0 });
        counts[observation.origin]++;
        if (observation.origin === "mouse" && observation.shortcut)
          expectedNotices++;
      }
      await coach.accept(parsed);
      await coach.accept(parsed);
      await Promise.all(deliveries);
    }
    assert.deepEqual(
      (await repository.query("2026-10-28", "2026-10-28")).counts["2026-10-28"],
      totals,
    );
    assert.equal(notices, expectedNotices);
    assert.equal(
      totals.W03.mouse,
      10,
      "existing maximize routes plus client click and pre-release event fallback",
    );
    assert.ok(totals.W04.key > 0);
    assert.ok(totals.W04.mouse > 0);
    assert.equal(totals.W05, undefined);
    assert.deepEqual(totals.W06, { mouse: 4, key: 3 });
    assert.deepEqual(totals.W07, { mouse: 6, key: 6 });
    assert.deepEqual(totals.W02, { mouse: 15, key: 5 });
    assert.deepEqual(totals.W11, { mouse: 1, key: 1 });
    for (const sample of report.compoundSamples) {
      // Each sample starts its own native observer session; reset the Core session as well.
      coach.begin(1);
      const parsed = candidateV2(sample);
      assert.ok(parsed);
      const observations = classifyGesture(parsed);
      assert.equal(observations.length, 2);
      for (const observation of observations)
        (totals[observation.operation] ??= { mouse: 0, key: 0 }).mouse++;
      await coach.accept(parsed);
      await coach.accept({ ...parsed, sequence: parsed.sequence + 1 });
      await Promise.all(deliveries);
      assert.deepEqual(
        (await repository.query("2026-10-28", "2026-10-28")).counts[
          "2026-10-28"
        ],
        totals,
      );
    }
    assert.equal(report.compoundSamples.length, 7);
    assert.equal(report.captionSamples.length, 6);
    for (const sample of report.captionSamples) {
      const parsed = candidateV2(sample);
      assert.ok(parsed);
      assert.deepEqual(
        classifyGesture(parsed).map((o) => o.operation),
        ["W01", sample.evidence.terminal === "maximized" ? "W03" : "W04"],
      );
    }
    assert.equal(
      notices,
      expectedNotices + 7,
      "each compound gesture requests only one notification",
    );
    assert.equal(report.independence.globalInputCollected, false);
    assert.equal(report.independence.rows.length, 49);
    assert.equal(report.independence.minimalComposerMismatches, 3);
    for (const row of report.independence.rows) {
      assert.deepEqual(
        row.composed,
        row.baseline,
        `${row.name}: full v2 parity`,
      );
      if (row.composed === null) {
        assert.deepEqual(row.expected, [], row.name);
        continue;
      }
      const parsed = candidateV2({ ...row.composed, date: "2026-10-28" });
      assert.ok(parsed, row.name);
      const observations = classifyGesture(parsed);
      assert.deepEqual(
        observations.map((o) => o.operation).sort(),
        row.expected,
        `${row.name}: final operation IDs`,
      );
      coach.begin(1);
      const before = await repository.query("2026-10-28", "2026-10-28");
      const previousNotices = notices;
      for (const observation of observations)
        (totals[observation.operation] ??= { mouse: 0, key: 0 }).mouse++;
      await coach.accept(parsed);
      await Promise.all(deliveries);
      const saved = await repository.query("2026-10-28", "2026-10-28");
      assert.deepEqual(saved.counts["2026-10-28"], totals, row.name);
      assert.equal(
        saved.revision,
        before.revision + 1,
        "one atomic transaction",
      );
      assert.equal(notices, previousNotices + 1, "one notification request");
      await coach.accept({ ...parsed, sequence: parsed.sequence + 1 });
      await Promise.all(deliveries);
      assert.deepEqual(
        await repository.query("2026-10-28", "2026-10-28"),
        saved,
        "transaction replay cannot change storage",
      );
      assert.equal(notices, previousNotices + 1);
    }
  },
);

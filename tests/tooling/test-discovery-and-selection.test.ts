import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const runner = resolve("scripts/test/test.mjs");

test("test CLI discovers nested suites and selects relative paths or unambiguous basenames", () => {
  mkdirSync(".tools/tests", { recursive: true });
  const cwd = mkdtempSync(resolve(".tools/tests/runner-discovery-"));
  try {
    for (const folder of [
      "operations",
      "records",
      "app/ipc",
      "native",
      "support",
      "fixtures",
    ]) {
      mkdirSync(join(cwd, "tests", folder), { recursive: true });
    }
    for (const [file, name] of [
      ["operations/shared.test.ts", "operation case"],
      ["records/shared.test.ts", "record case"],
      ["app/ipc/native-message.test.ts", "unit protocol case"],
      ["native/helper.test.ts", "native helper case"],
    ])
      writeFileSync(
        join(cwd, "tests", file),
        `import { test } from 'node:test'; test('${name}', () => {});`,
      );
    for (const folder of ["support", "fixtures"]) {
      writeFileSync(
        join(cwd, "tests", folder, "ignored.test.ts"),
        "throw new Error('support must not run');",
      );
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = (suite: string, ...args: string[]) =>
      spawnSync(
        process.execPath,
        [runner, suite, "--test-reporter=tap", ...args],
        {
          cwd,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
        },
      );
    const unit = run("unit");
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /# tests 3/);
    assert.doesNotMatch(unit.stdout, /native helper case/);
    const native = run("native");
    assert.equal(native.status, 0, native.stdout + native.stderr);
    assert.match(native.stdout, /# tests 1/);
    assert.match(native.stdout, /native helper case/);
    for (const file of [
      "app/ipc/native-message.test.ts",
      "native-message.test.ts",
      "operations/shared.test.ts",
    ]) {
      const selected = run("unit", "--file=" + file, "--file=" + file);
      assert.equal(selected.status, 0, selected.stdout + selected.stderr);
      assert.match(selected.stdout, /# tests 1/);
    }
    for (const file of [
      "shared.test.ts",
      "../outside.test.ts",
      "operations/../records/shared.test.ts",
      "/absolute.test.ts",
      "native/helper.test.ts",
      "support/ignored.test.ts",
      "fixtures/ignored.test.ts",
      "missing.test.ts",
    ]) {
      const rejected = run("unit", "--file=" + file);
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.doesNotMatch(
        rejected.stdout,
        /operation case|record case|unit protocol case|native helper case/,
      );
    }
    assert.match(run("unit", "--file=shared.test.ts").stderr, /Ambiguous/);
    assert.equal(run("native", "--file=helper.test.ts").status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test CLI selects a file and name while retaining module mock support", () => {
  const parent = resolve(".tools/tests");
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, "runner-"));
  try {
    mkdirSync(join(cwd, "tests"));
    writeFileSync(
      join(cwd, "tests/selected.test.ts"),
      `
      import { test, mock } from 'node:test';
      import assert from 'node:assert/strict';
      import { resolve } from 'node:path';
      mock.module('node:os', { namedExports: { hostname: () => 'fixture' } });
      assert.equal(process.env.TEMP, resolve('.tools/test-temp'));
      const { hostname } = await import('node:os');
      test('selected case', () => assert.equal(hostname(), 'fixture'));
      test('excluded case', () => assert.fail('name filter ignored'));
    `,
    );
    writeFileSync(
      join(cwd, "tests/other.test.ts"),
      "throw new Error('file filter ignored');",
    );
    mkdirSync(join(cwd, "tests/native"));
    writeFileSync(
      join(cwd, "tests/native/native-fixture.test.ts"),
      "import { test } from 'node:test'; test('native fixture', () => {});",
    );
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [runner, "unit", ...args], {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      });
    const selected = run(
      "--file=selected.test.ts",
      "--test-name-pattern=^selected case$",
      "--test-reporter=tap",
      "--test-concurrency=1",
    );
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    assert.match(selected.stdout, /ok 1 - selected case/);
    const failure = run(
      "--file=selected.test.ts",
      "--test-name-pattern=^excluded case$",
    );
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    const all = run();
    assert.equal(all.status, 1, all.stdout + all.stderr);
    assert.match(all.stdout + all.stderr, /file filter ignored/);
    const native = spawnSync(
      process.execPath,
      [
        runner,
        "native",
        "--file=native-fixture.test.ts",
        "--test-concurrency=4",
      ],
      {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      },
    );
    assert.equal(native.status, 0, native.stdout + native.stderr);
    assert.match(native.stdout, /native fixture/);
    for (const args of [
      ["--file=missing.test.ts"],
      ["--file=../selected.test.ts"],
      ["--file=native-fixture.test.ts"],
      ["--typo"],
      ["--file=selected.test.ts", "--test-name-pattern=["],
    ]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
      assert.doesNotMatch(invalid.stdout, /selected case|file filter ignored/);
    }
    for (const concurrency of [
      "",
      "0",
      "-1",
      "3",
      "1.5",
      "16",
      "2 --test-isolation=none",
    ]) {
      const invalid = run("--test-concurrency=" + concurrency);
      assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
      assert.match(invalid.stderr, /Unknown test option/);
      assert.doesNotMatch(invalid.stdout, /selected case|file filter ignored/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("test CLI runs independent files concurrently while retaining process isolation", () => {
  mkdirSync(".tools/tests", { recursive: true });
  const cwd = mkdtempSync(resolve(".tools/tests/runner-concurrency-"));
  try {
    mkdirSync(join(cwd, "tests"));
    for (const [own, other] of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      writeFileSync(
        join(cwd, "tests", own + ".test.ts"),
        `
        import { test } from 'node:test';
        import assert from 'node:assert/strict';
        import { writeFile, readFile, rename } from 'node:fs/promises';
        import { setTimeout } from 'node:timers/promises';
        test('file barrier ${own}', async () => {
          await writeFile('${own}.pending', String(process.pid));
          await rename('${own}.pending', '${own}.ready');
          const deadline = performance.now() + 3000;
          let peer;
          while (performance.now() < deadline) {
            try { peer = await readFile('${other}.ready', 'utf8'); break; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            await setTimeout(10);
          }
          assert.ok(peer, 'both files must reach the barrier concurrently');
          assert.notEqual(Number(peer), process.pid, 'each file has its own process');
        });
      `,
      );
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [runner, "unit", "--test-concurrency=2", "--test-reporter=tap"],
      {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 2/);
    assert.match(result.stdout, /# pass 2/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

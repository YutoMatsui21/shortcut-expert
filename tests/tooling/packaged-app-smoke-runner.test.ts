import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const runner = resolve("scripts/test/ci-package-smoke.mjs");
for (const failing of ["none", "smoke", "package", "log"]) {
  test(`CI packaging and smoke overlap and preserve ${failing} failure`, (t) => {
    mkdirSync(".tools/tests", { recursive: true });
    const root = mkdtempSync(resolve(".tools/tests/ci-package-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "scripts/test"), { recursive: true });
    mkdirSync(join(root, "scripts/dev"), { recursive: true });
    if (failing === "log")
      mkdirSync(join(root, ".tools/test-results/package.log"), {
        recursive: true,
      });
    for (const [own, peer, file] of [
      ["smoke", "package", "smoke.mjs"],
      ["package", "smoke", "dev-run.mjs"],
    ]) {
      writeFileSync(
        join(root, "scripts", own === "smoke" ? "test" : "dev", file),
        `
        import { writeFile, rename, access } from 'node:fs/promises';
        import { setTimeout } from 'node:timers/promises';
        import assert from 'node:assert/strict';
        ${own === "package" ? "assert.deepEqual(process.argv.slice(2), ['electron-builder','--dir','--win','--x64','--publish','never']);" : ""}
        await writeFile('${own}.pending', 'ready');
        await rename('${own}.pending', '${own}.started');
        const deadline = performance.now() + 3000;
        while (true) {
          try { await access('${peer}.started'); break; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (performance.now() > deadline) throw new Error('commands must overlap');
          await setTimeout(10);
        }
        console.log('${own} stdout');
        console.error('${own} stderr');
        await writeFile('${own}.finished', 'done');
        process.exitCode = ${failing === own ? 7 : 0};
      `,
      );
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [runner], {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 12_000,
    });
    assert.equal(
      result.status,
      failing === "none" ? 0 : 1,
      result.stdout + result.stderr,
    );
    if (failing === "log") assert.match(result.stderr, /package log:/);
    for (const name of ["smoke", "package"]) {
      assert.ok(
        existsSync(join(root, name + ".finished")),
        "both children finish before the runner exits",
      );
      if (failing === "log" && name === "package") continue;
      const log = readFileSync(
        join(root, ".tools/test-results", name + ".log"),
        "utf8",
      );
      assert.match(log, new RegExp(name + " stdout"));
      assert.match(log, new RegExp(name + " stderr"));
    }
  });
}

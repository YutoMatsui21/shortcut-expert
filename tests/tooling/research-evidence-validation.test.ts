import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("Snap Layout source archives retain their recorded hashes after Git stages them with autocrlf enabled", (t) => {
  mkdirSync(".tools/tests", { recursive: true });
  const root = mkdtempSync(resolve(".tools/tests/research-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.autocrlf=true", ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "--quiet");
  writeFileSync(join(root, ".gitattributes"), readFileSync(".gitattributes"));
  const summary = JSON.parse(
    readFileSync(
      "validation/evidence/snap-layout-summary-20261022.json",
      "utf8",
    ),
  );
  const hashes = new Set<string>(
    summary.sessions.map(
      (session: { sourceSha256: string }) => session.sourceSha256,
    ),
  );
  for (const expected of hashes) {
    const file = `validation/evidence/snap-layout-sources/${expected}.cs.txt`;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(file));
  }
  git("add", ".");
  for (const expected of hashes) {
    const file = `validation/evidence/snap-layout-sources/${expected}.cs.txt`;
    const staged = git("show", ":" + file);
    assert.equal(
      createHash("sha256").update(staged).digest("hex"),
      expected,
      file,
    );
  }
});

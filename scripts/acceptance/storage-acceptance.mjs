import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join, normalize } from "node:path";
import { extractFile } from "@electron/asar";
import { developmentEnvironment } from "../dev/dev-environment.mjs";

const packageArg = process.argv.find((value) =>
  value.startsWith("--package-dir="),
);
const directory = resolve(
  packageArg?.slice("--package-dir=".length) ?? "release/win-unpacked",
);
const asar = join(directory, "resources/app.asar");
const sha = (value) => createHash("sha256").update(value).digest("hex");
// Refuse stale packaging, including shared chunks used by the acceptance entry.
const { readdirSync } = await import("node:fs");
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(root, entry.name))
      : [join(root, entry.name)],
  );
}
const hashes = {};
for (const file of files("out/main")) {
  const packaged = extractFile(asar, normalize(file));
  assert.equal(
    sha(packaged),
    sha(readFileSync(file)),
    "Rebuild/repackage changed Main: " + file,
  );
  if (file.endsWith("storage-worker.cjs") || file.includes("chunks")) {
    assert.equal(
      sha(readFileSync(join(directory, "resources/app.asar.unpacked", file))),
      sha(packaged),
      "Unpacked mismatch: " + file,
    );
  }
  hashes[file] = sha(packaged);
}
mkdirSync(".tools/validation", { recursive: true });
const output = mkdtempSync(resolve(".tools/validation/v02-"));
const executable = join(directory, "Shortcut Expert.exe");
const environment = {
  ...developmentEnvironment(),
  ELECTRON_RUN_AS_NODE: "1",
  COACH_V02_OUTPUT: output,
  COACH_V02_ENTRY: join(asar, "out/main/storage-acceptance.cjs"),
  COACH_V02_WORKER: join(
    directory,
    "resources/app.asar.unpacked/out/main/storage-worker.cjs",
  ),
  COACH_V02_ELECTRON: JSON.parse(readFileSync("package.json", "utf8"))
    .devDependencies.electron,
};
delete environment.ELECTRON_RENDERER_URL;
delete environment.COACH_TEST_DATA_DIR;
const started = new Date().toISOString();
const result = spawnSync(
  executable,
  [resolve("validation/storage-acceptance.cjs")],
  {
    env: environment,
    windowsHide: true,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  },
);
writeFileSync(
  join(output, "runtime.log"),
  (result.stdout ?? "") + (result.stderr ?? ""),
);
const report = {
  commit: spawnSync(
    "git",
    [
      "-c",
      "safe.directory=" + process.cwd().replaceAll("\\", "/"),
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8" },
  ).stdout.trim(),
  asarHash: sha(readFileSync(asar)),
  executableHash: sha(readFileSync(executable)),
  hashes,
  harnessHash: sha(readFileSync("validation/storage-acceptance.cjs")),
  started,
  status: result.status,
  signal: result.signal,
  ...(result.error ? { error: result.error.message } : {}),
  scope:
    "packaged Electron / bundled repository, Core, Store and Worker; isolated synthetic disk fixtures",
  untested: [
    "physical volume exhaustion",
    "power loss",
    "OS crash",
    "physical I/O failure",
    "natural input",
    "NSIS upgrade",
  ],
};
writeFileSync(join(output, "build.json"), JSON.stringify(report, null, 2));
console.log(result.stdout ?? "");
console.error(result.stderr ?? "");
console.log("V02 evidence: " + output);
assert.equal(result.status, 0, "V02 failed or timed out");
assert.match(result.stdout, /V02_SUITE_OK/);

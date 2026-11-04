import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { developmentEnvironment } from "../dev/dev-environment.mjs";
import { smokeSucceeded, smokeFailureSummary } from "./smoke-result.mjs";

const packaged = process.argv.includes("--packaged");
const packageOption = process.argv.indexOf("--package-dir");
const packageDir =
  packageOption >= 0 ? process.argv[packageOption + 1] : "release";
if (!packageDir) throw new Error("--package-dir needs a folder");
// Electron can install its binary during module loading, before the app is spawned.
const environment = developmentEnvironment();
Object.assign(process.env, environment);
const executable = packaged
  ? resolve(packageDir, "win-unpacked/Shortcut Expert.exe")
  : (await import("electron")).default;
const migration = process.argv.includes("--migration");
const comparison = process.argv.includes("--comparison");
const settings = process.argv.includes("--settings");
const activation = process.argv.includes("--activation");
if (activation && (settings || migration || comparison))
  throw new Error("--activation uses its own SQLite restart fixture");
if (migration && comparison)
  throw new Error("--comparison and --migration use different fixtures");
if (settings && (migration || comparison))
  throw new Error("--settings uses its own empty SQLite fixture");
const options = [
  migration
    ? "--migration-smoke"
    : process.argv.includes("--storage") || comparison || settings || activation
      ? "--storage-smoke"
      : "--coach-smoke",
];
if (activation) options.push("--activation-smoke");
if (settings) options.push("--settings-smoke");
if (comparison) options.push("--comparison-smoke");
const args = packaged ? options : [resolve("."), ...options];
mkdirSync(resolve(".tools/tests"), { recursive: true });
environment.COACH_TEST_DATA_DIR = mkdtempSync(
  join(resolve(".tools/tests"), "coach-"),
);
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
if (migration) {
  writeFileSync(
    join(environment.COACH_TEST_DATA_DIR, "counts.json"),
    '  {"schemaVersion":1,"days":{"2020-01-02":{"W03":{"mouse":7,"key":5},"W09":{"mouse":100,"key":100}}}}\n',
  );
  writeFileSync(
    join(environment.COACH_TEST_DATA_DIR, "settings.json"),
    '{"schemaVersion":1,"muted":["W03","W09"],"opened":true}',
  );
}
if (activation)
  writeFileSync(
    join(environment.COACH_TEST_DATA_DIR, "settings.json"),
    '{"schemaVersion":1,"muted":[],"opened":true}',
  );
if (comparison) {
  const today = new Date();
  const day = (offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  writeFileSync(
    join(environment.COACH_TEST_DATA_DIR, "counts.json"),
    JSON.stringify({
      schemaVersion: 1,
      days: {
        [day(0)]: {
          W02: { mouse: 0, key: 2 },
          W06: { mouse: 1, key: 0 },
          W11: { mouse: 1, key: 3 },
        },
        [day(7)]: {
          W04: { mouse: 2, key: 0 },
          W07: { mouse: 1, key: 0 },
          W11: { mouse: 1, key: 1 },
        },
      },
    }),
  );
}
for (let boot = 0; boot < (activation ? 5 : migration ? 2 : 1); boot++) {
  const bootArgs =
    !activation || boot === 0
      ? args
      : boot === 4
        ? [...args, "--activation-failure-smoke"]
        : boot === 3
          ? [...args, "--login-startup-smoke"]
          : [
              ...args,
              "--activation-stopped-smoke",
              ...(boot === 2 ? ["--login-startup-smoke"] : []),
            ];
  const result = spawnSync(executable, bootArgs, {
    // STARTUPINFO's hidden show state overrides the first ShowWindow on Windows.
    // Activation checks must observe the app's actual initial display request.
    encoding: "utf8",
    windowsHide: !activation,
    timeout: 30_000,
    maxBuffer: 65_536,
    env: environment,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) console.error(result.error.message);
  const success = smokeSucceeded(result);
  if (!success && result.stderr) process.stderr.write(result.stderr);
  if (!success) {
    console.error(smokeFailureSummary(result, options[0], boot + 1));
    process.exit(1);
  }
}
process.exit(0);

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { developmentEnvironment } from "../dev/dev-environment.mjs";

const suite = process.argv[2];
if (!["unit", "native"].includes(suite))
  throw new Error("Expected unit or native suite");
const options = process.argv.slice(3);
const selected = [];
const forwarded = [];
for (const option of options) {
  if (option === "--coverage") continue;
  if (option.startsWith("--file=")) {
    const file = option.slice("--file=".length);
    if (!/^(?:[\w-]+\/)*[\w.-]+\.test\.ts$/.test(file))
      throw new Error(
        "Expected a test filename or relative path inside tests/",
      );
    selected.push(file);
  } else if (option.startsWith("--test-name-pattern=")) {
    const pattern = option.slice("--test-name-pattern=".length);
    if (!pattern) throw new Error("Expected a non-empty test name pattern");
    new RegExp(pattern);
    forwarded.push(option);
  } else if (/^--test-reporter=(spec|tap|dot)$/.test(option)) {
    forwarded.push(option);
  } else if (/^--test-concurrency=(1|2|4|8)$/.test(option)) {
    forwarded.push(option);
  } else throw new Error(`Unknown test option: ${option}`);
}
// Classify by responsibility directory, never by a test's basename.
function discover(directory = "") {
  return readdirSync(posix.join("tests", directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relative = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["support", "fixtures", "bin", "obj"].includes(entry.name)) return [];
      return discover(relative);
    }
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [relative] : [];
  });
}
const available = discover().filter(
  (name) => name.startsWith("native/") === (suite === "native"),
);
const resolved = [];
for (const file of selected) {
  const matches = available.filter((name) =>
    file.includes("/") ? name === file : posix.basename(name) === file,
  );
  if (!matches.length)
    throw new Error(`Test is not in the ${suite} suite: ${file}`);
  if (matches.length > 1)
    throw new Error(`Ambiguous test filename; use a relative path: ${file}`);
  resolved.push(matches[0]);
}
const files = (selected.length ? [...new Set(resolved)] : available)
  .sort()
  .map((name) => `tests/${name}`);
if (!files.length) throw new Error(`No ${suite} tests discovered`);
const args = [
  "--experimental-test-module-mocks",
  "--test",
  "--test-timeout=" + (suite === "native" ? "60000" : "10000"),
];
if (process.argv.includes("--coverage"))
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-include=src/**/*.ts",
  );
const result = spawnSync(process.execPath, [...args, ...forwarded, ...files], {
  stdio: "inherit",
  windowsHide: true,
  env: developmentEnvironment(),
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

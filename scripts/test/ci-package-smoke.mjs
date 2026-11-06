import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync } from "node:fs";

mkdirSync(".tools/test-results", { recursive: true });
async function run(name, args) {
  let failed = false;
  const path = `.tools/test-results/${name}.log`;
  const output = createWriteStream(path);
  const logClosed = new Promise((resolve) => output.once("close", resolve));
  output.once("error", (error) => {
    failed = true;
    console.error(name + " log:", error.message);
  });
  const result = await new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const log = (chunk) => {
        if (!output.destroyed) output.write(chunk);
      };
      child.stdout?.on("data", log);
      child.stderr?.on("data", log);
      child.once("error", (error) => {
        failed = true;
        console.error(name, error.message);
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    } catch (error) {
      console.error(name, error.message);
      resolve({ code: 1, signal: null });
    }
  });
  if (!output.destroyed) output.end();
  await logClosed;
  console.log(
    `CI ${name}: exit=${result.code} signal=${result.signal ?? "none"}`,
  );
  if (!failed) {
    try {
      process.stdout.write(readFileSync(path));
    } catch (error) {
      failed = true;
      console.error(name, error.message);
    }
  }
  return result.code === 0 && !failed;
}

// Both commands read the already-built out/helper. Only packaging writes release/.
// Wait for both children even if one fails; later hashes and packaged tests must not race packaging.
const results = await Promise.allSettled([
  run("smoke", ["scripts/test/smoke.mjs"]),
  run("package", [
    "scripts/dev/dev-run.mjs",
    "electron-builder",
    "--dir",
    "--win",
    "--x64",
    "--publish",
    "never",
  ]),
]);
for (const result of results)
  if (result.status === "rejected") console.error(result.reason);
if (!results.every((result) => result.status === "fulfilled" && result.value))
  process.exitCode = 1;

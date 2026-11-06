import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { finalInputCases } from "../../src/main/final-input-cases.ts";
import { developmentEnvironment } from "../dev/dev-environment.mjs";
import { packageManifest } from "./ui-acceptance-runtime.mjs";

const option = process.argv.indexOf("--package-dir");
if (option < 0 || !process.argv[option + 1])
  throw new Error("Pass --package-dir release/<build>");
const compileOnly = process.argv.includes("--compile-only");
const nativeDiagnostics = process.argv.includes("--diagnostics");
if (!compileOnly && !process.argv.includes("--observe-consented"))
  throw new Error("Explicit natural-input consent required");
const root = resolve(".tools/validation/issue-47");
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, "session-"));
const data = join(directory, "data");
await mkdir(data);
const source = resolve("validation/issue-47/FinalInputPanel.cs"),
  panelPath = join(directory, "FinalInputPanel.exe");
await promisify(execFile)(
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  ),
  [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    `/out:${panelPath}`,
    "/reference:System.Web.Extensions.dll",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    source,
  ],
  { windowsHide: true },
);
await writeFile(join(directory, "cases.json"), JSON.stringify(finalInputCases));
if (compileOnly) {
  console.log("FINAL_PANEL_COMPILE_OK");
  process.exit(0);
}
const packageRoot = resolve(process.argv[option + 1], "win-unpacked");
if (
  !(await readFile(join(packageRoot, "resources/app.asar"))).includes(
    Buffer.from("--final-natural-acceptance"),
  )
)
  throw new Error("Rebuild/package first");
const files = packageManifest(packageRoot),
  sha = (value) => createHash("sha256").update(value).digest("hex");
await writeFile(
  join(directory, "build.json"),
  JSON.stringify(
    {
      manifestSha256: sha(JSON.stringify(files)),
      files,
      panelSourceSha256: sha(await readFile(source)),
      nativeDiagnostics,
      input: "manual physical input only",
      consent: "explicit user consent; --observe-consented",
    },
    null,
    2,
  ),
);
const env = { ...developmentEnvironment(), COACH_TEST_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const product = spawn(
  join(packageRoot, "Shortcut Expert.exe"),
  [
    "--final-natural-acceptance",
    ...(nativeDiagnostics ? ["--caption-diagnostics"] : []),
  ],
  { env, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] },
);
console.log("FINAL_SESSION " + directory);
let panel,
  stopTimer,
  ready = false,
  ending = false;
const stop = async () => {
  if (ending || product.exitCode !== null || product.signalCode !== null)
    return;
  ending = true;
  stopTimer = setTimeout(() => product.kill(), 6000);
  try {
    await writeFile(
      join(data, "launcher-end.tmp"),
      JSON.stringify({ sequence: Number.MAX_SAFE_INTEGER, action: "end" }),
    );
    await rename(join(data, "launcher-end.tmp"), join(data, "control.json"));
  } catch {
    product.kill();
  }
};
// Never persist arbitrary application stderr or OS messages. Evidence is fixed-schema status/SQLite only.
let output = "";
product.stdout.on("data", (chunk) => {
  output = (output + chunk.toString()).slice(-4096);
  if (!ready && output.includes("ALL_NATURAL_READY")) {
    ready = true;
    console.log("FINAL_READY observation stopped; arm in operator panel");
    panel = spawn(panelPath, [data, join(directory, "cases.json")], {
      windowsHide: false,
      stdio: "ignore",
    });
    panel.on("error", () => {
      console.error("FINAL_PANEL_START_FAILED");
      void stop();
    });
    panel.once("exit", () => {
      void stop();
    });
  }
});
product.stderr.on("data", () => {});
product.on("error", () => {
  console.error("FINAL_PRODUCT_START_FAILED");
  process.exitCode = 1;
});
const deadline = setTimeout(() => {
  console.error("FINAL_SESSION_DEADLINE");
  void stop();
  panel?.kill();
}, 21 * 60_000);
const result = await new Promise((resolve) =>
  product.once("close", (code, signal) => resolve({ code, signal, ready })),
);
clearTimeout(deadline);
clearTimeout(stopTimer);
panel?.kill();
await writeFile(join(directory, "exit.json"), JSON.stringify(result));
const after = sha(JSON.stringify(packageManifest(packageRoot)));
if (after !== sha(JSON.stringify(files)))
  throw new Error("Candidate build changed during session");
console.log("FINAL_SESSION_EXIT " + JSON.stringify(result));
process.exitCode = result.code === 0 && ready ? 0 : 1;

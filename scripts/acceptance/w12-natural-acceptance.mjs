import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  appendFile,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { developmentEnvironment } from "../dev/dev-environment.mjs";
import { packageManifest } from "./ui-acceptance-runtime.mjs";

const option = process.argv.indexOf("--package-dir");
if (option < 0 || !process.argv[option + 1])
  throw new Error("Pass --package-dir release/<build>");
const compileOnly = process.argv.includes("--compile-only");
if (!compileOnly && !process.argv.includes("--observe-consented"))
  throw new Error(
    "Natural input requires explicit consent and --observe-consented",
  );
const root = resolve(".tools/validation/w12-natural");
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, "session-"));
const data = join(directory, "data");
await mkdir(data);
const source = resolve("validation/probes/W12NaturalPanel.cs");
const panelPath = join(directory, "W12NaturalPanel.exe");
const csc = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
const run = promisify(execFile);
await run(
  csc,
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
  { windowsHide: false },
);
if (compileOnly) {
  console.log("W12_PANEL_COMPILE_OK");
  process.exit(0);
}
const packageRoot = resolve(process.argv[option + 1], "win-unpacked");
if (
  !(await readFile(join(packageRoot, "resources/app.asar"))).includes(
    Buffer.from("--w12-natural-acceptance"),
  )
)
  throw new Error(
    "Rebuild/package first: this product has no isolated natural acceptance entry",
  );
const manifest = packageManifest(packageRoot);
const manifestText = JSON.stringify(manifest);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
await writeFile(
  join(directory, "build.json"),
  JSON.stringify(
    {
      manifestSha256: sha256(manifestText),
      files: manifest,
      panelSourceSha256: sha256(await readFile(source)),
      input: "manual physical input only",
      consent: "explicit user consent required by --observe-consented",
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
  ["--w12-natural-acceptance"],
  { env, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] },
);
console.log("W12_SESSION " + directory);
let panel;
let panelExitDeadline;
let output = "";
const log = async (chunk) => {
  const text = chunk.toString();
  output += text;
  await appendFile(join(directory, "session.log"), text);
  if (!panel && output.includes("W12_NATURAL_READY")) {
    panel = spawn(panelPath, [data], { windowsHide: false, stdio: "ignore" });
    panel.on("error", (error) => {
      console.error(error.message);
      product.kill();
    });
    panel.once("exit", async () => {
      if (product.exitCode !== null || product.signalCode !== null) return;
      // A crashed panel cannot send FormClosing/END. Cancel active trials and stop the real helper.
      panelExitDeadline = setTimeout(() => product.kill(), 2500);
      try {
        await writeFile(
          join(data, "launcher-end.tmp"),
          JSON.stringify({ sequence: Number.MAX_SAFE_INTEGER, action: "end" }),
        );
        await rename(
          join(data, "launcher-end.tmp"),
          join(data, "control.json"),
        );
      } catch {
        product.kill();
      }
    });
  }
};
product.stdout.on("data", (chunk) => {
  void log(chunk);
});
product.stderr.on("data", (chunk) => {
  void log(chunk);
});
product.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
const deadline = setTimeout(() => {
  console.error("W12_SESSION_DEADLINE");
  product.kill();
  panel?.kill();
}, 21 * 60_000);
const result = await new Promise((resolve) =>
  product.once("exit", (code, signal) => resolve({ code, signal })),
);
clearTimeout(deadline);
clearTimeout(panelExitDeadline);
panel?.kill();
await writeFile(join(directory, "exit.json"), JSON.stringify(result));
console.log("W12_SESSION_EXIT " + JSON.stringify(result));
process.exitCode = result.code === 0 ? 0 : 1;

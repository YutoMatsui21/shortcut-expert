// Isolated probe launcher. No observation unless --observe-consented is explicitly supplied.
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dotnet, dotnetEnvironment } from "../dev/dotnet.mjs";
const mode = process.argv[2] ?? "--build";
if (
  !["--build", "--observe-consented"].includes(mode) ||
  process.argv.length > 3
)
  throw new Error(
    "Use --build or --observe-consented after explicit physical-input consent",
  );
const project = "validation/probes/mouse-shadow/MouseShadow.csproj";
const result = spawnSync(
  dotnet,
  ["build", project, "-c", "Release", "--nologo"],
  { env: dotnetEnvironment, stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) throw new Error("Shadow probe build failed");
const dll = resolve(
  "validation/probes/mouse-shadow/bin/Release/net10.0-windows/MouseShadow.dll",
);
const output = resolve(".tools/validation/mouse-shadow");
await mkdir(output, { recursive: true });
const sha256 = createHash("sha256")
  .update(await readFile(dll))
  .digest("hex");
console.log(
  JSON.stringify({ mode, probeSha256: sha256, productChanged: false }),
);
if (mode === "--observe-consented") {
  const file = resolve(output, `trials-${Date.now()}.jsonl`);
  await writeFile(
    file,
    JSON.stringify({
      kind: "session",
      probeSha256: sha256,
      productChanged: false,
    }) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      file,
      instructions:
        "Select app/case; ARM; focus starting app within 5 seconds; physical operation after ARMED; wait for FINISH. No injected automation.",
    }),
  );
  // Visible launch is intentional: this is the interactive user-operated panel.
  const child = spawn(dotnet, [dll, mode, file], {
    env: dotnetEnvironment,
    stdio: "inherit",
    windowsHide: false,
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Probe exit ${code}; unfinished trial is not evidence`),
          ),
    );
  });
}

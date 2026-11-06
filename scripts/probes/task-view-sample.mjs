// Authorized live research only. Samples structure; never input hooks or app content.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const seconds = process.argv[2] === "--seconds=30" ? 30 : 60;
if (
  process.platform !== "win32" ||
  process.argv.length > 3 ||
  (process.argv[2] !== undefined &&
    !["--seconds=30", "--seconds=60"].includes(process.argv[2]))
) {
  console.error(
    "Windows only. Use --seconds=30 or --seconds=60 (default); live research.",
  );
  process.exit(2);
}
const dir = path.join(root, ".tools/validation/task-view");
const exe = path.join(dir, "TaskViewProviderProbe.exe");
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
try {
  // Compile once and verify offline boundaries before starting the sampling clock.
  const built = await run(
    process.execPath,
    [path.join(root, "scripts/probes/task-view-probe.mjs")],
    { cwd: root, windowsHide: true, timeout: 40_000 },
  );
  if (!built.stdout.includes("TASK_VIEW_PROBE_SELF_TEST_OK"))
    throw new Error("Self-test failed");
  const records = [
    {
      kind: "sampling-session",
      durationSeconds: seconds,
      sourceSha256: await hash(
        path.join(root, "validation/probes/TaskViewProviderProbe.cs"),
      ),
      probeSha256: await hash(exe),
      originMeasured: false,
      selectorVerified: false,
    },
  ];
  const started = Date.now();
  console.log(`SAMPLING_STARTED (${seconds} seconds)`);
  let sample = 0;
  while (Date.now() - started < seconds * 1000) {
    const mode = ["--point-host", "--snapshot", "--discover-hosts"][sample % 3];
    let stdout = "",
      failed = false;
    try {
      ({ stdout } = await run(exe, [mode], {
        cwd: root,
        windowsHide: true,
        timeout: Math.max(
          1,
          Math.min(15_000, seconds * 1000 - (Date.now() - started)),
        ),
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      stdout = error.stdout || "";
      failed = true;
    }
    records.push({ kind: "sample-start", sample, mode });
    let end = null;
    for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        records.push(row);
        if (row.kind === "snapshot-end") end = row;
      } catch {
        failed = true;
      }
    }
    records.push({
      kind: "sample-end",
      sample,
      workerSucceeded: !failed,
      completed: !failed && end?.completed === true,
      originMeasured: false,
    });
    sample++;
    if (Date.now() - started < seconds * 1000 - 500)
      await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const file = path.join(dir, `sampling-${started}.jsonl`);
  records.push({
    kind: "sampling-end",
    samples: sample,
    originMeasured: false,
    selectorVerified: false,
  });
  await writeFile(
    file,
    records.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      file,
      samples: sample,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    }),
  );
} catch {
  console.error("TASK_VIEW_SAMPLING_FAILED");
  process.exitCode = 1;
}

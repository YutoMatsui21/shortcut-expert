// Feasibility check only; no application implementation or input automation.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL("../../.tools/validation/NativeHealthProbe.exe", import.meta.url),
);
const output: string = execFileSync(executable, [], {
  encoding: "utf8",
  timeout: 10000,
  windowsHide: true,
});
const result: Record<string, unknown> = JSON.parse(output.trim());
if (result.kind !== "api-health-only" || result.inputPayloadRead !== false) {
  throw new Error("Unexpected probe result");
}
console.log(
  JSON.stringify({
    runtime: process.version,
    typescriptToNativeProcess: true,
    result,
  }),
);

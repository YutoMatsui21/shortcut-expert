import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { dotnet, dotnetEnvironment } from "../../scripts/dev/dotnet.mjs";

test(
  "isolated live Shadow adapter builds without product helper changes",
  { timeout: 60000 },
  () => {
    const result = spawnSync(
      dotnet,
      [
        "build",
        "validation/probes/mouse-shadow/MouseShadow.csproj",
        "-c",
        "Release",
        "--nologo",
        "-o",
        ".tools/validation/mouse-shadow/ci-build",
      ],
      {
        env: dotnetEnvironment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 55000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

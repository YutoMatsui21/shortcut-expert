import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("lint distinguishes errors, warnings, and unawaited test promises", (t) => {
  mkdirSync(".tools/tests", { recursive: true });
  const root = mkdtempSync(resolve(".tools/tests/oxlint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "tests");
  mkdirSync(directory);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: ["node"],
        typeRoots: [resolve("node_modules/@types")],
        strict: true,
        noEmit: true,
      },
      include: ["tests"],
    }),
  );
  const file = join(directory, "probe.ts");
  const lint = () =>
    spawnSync(
      process.execPath,
      [
        resolve("node_modules/oxlint/bin/oxlint"),
        "--config",
        resolve(".oxlintrc.json"),
        "--type-aware",
        "--format",
        "json",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  writeFileSync(
    file,
    `import { test } from "node:test";
async function work() { return 1; }
test("parent", async (t) => {
  work();
  t.test("child", () => {});
});
`,
  );
  const warnings = lint();
  assert.equal(warnings.status, 0, warnings.stderr);
  const diagnostics = JSON.parse(warnings.stdout).diagnostics;
  assert.deepEqual(
    diagnostics
      .filter(
        (d: { code: string }) => d.code === "typescript(no-floating-promises)",
      )
      .map(
        (d: { labels: { span: { line: number } }[] }) => d.labels[0].span.line,
      )
      .sort((a: number, b: number) => a - b),
    [3, 4, 5],
  );
  writeFileSync(file, `const x = 1;\nx = 2;\n`);
  const error = lint();
  assert.notEqual(error.status, 0);
  assert.ok(
    JSON.parse(error.stdout).diagnostics.some(
      (d: { severity: string }) => d.severity === "error",
    ),
  );
});

test("Core and Shared reject Node and Electron imports but allow ordinary modules", (t) => {
  mkdirSync(".tools/tests", { recursive: true });
  const root = mkdtempSync(resolve(".tools/tests/oxlint-boundaries-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
      },
      include: ["src"],
    }),
  );
  for (const area of ["core", "shared"]) {
    const directory = join(root, "src", area);
    mkdirSync(directory, { recursive: true });
    const file = join(directory, "probe.ts");
    writeFileSync(
      file,
      `import "node:fs";\nimport "fs";\nimport "node:fs/promises";\nimport "fs/promises";\nimport "electron";\nimport "ordinary-package";\nimport("node:path");\nrequire("node:fs");\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/oxlint/bin/oxlint"),
        "--config",
        resolve(".oxlintrc.json"),
        "--type-aware",
        "--format",
        "json",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(result.status, 0, result.stderr);
    const diagnostics = JSON.parse(result.stdout).diagnostics;
    assert.deepEqual(
      diagnostics
        .filter(
          (d: { code: string }) => d.code === "eslint(no-restricted-imports)",
        )
        .map(
          (d: { labels: { span: { line: number } }[] }) =>
            d.labels[0].span.line,
        )
        .sort((a: number, b: number) => a - b),
      [1, 2, 3, 4, 5, 7],
      area,
    );
    assert.ok(
      diagnostics.some(
        (d: { code: string }) => d.code === "typescript(no-require-imports)",
      ),
      area,
    );
    const jsFile = join(directory, "probe.js");
    writeFileSync(jsFile, 'require("fs");\n');
    const js = spawnSync(
      process.execPath,
      [
        resolve("node_modules/oxlint/bin/oxlint"),
        "--config",
        resolve(".oxlintrc.json"),
        "--format",
        "json",
        jsFile,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(js.status, 0, js.stderr);
    assert.ok(
      JSON.parse(js.stdout).diagnostics.some(
        (d: { code: string }) => d.code === "typescript(no-require-imports)",
      ),
      area,
    );
  }
});

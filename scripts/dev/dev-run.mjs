import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  developmentEnvironment,
  checkWritableDirectories,
} from "./dev-environment.mjs";

const env = developmentEnvironment();
const [tool, ...args] = process.argv.slice(2);
const entries = {
  "npm-ci":
    process.env.npm_execpath ??
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  "electron-vite": "node_modules/electron-vite/bin/electron-vite.js",
  "electron-builder": "node_modules/electron-builder/cli.js",
  "electron-install": "node_modules/electron/install.js",
  tsc: "node_modules/typescript/bin/tsc",
};
if (tool === "check") {
  if (
    args.length > 1 ||
    (args.length &&
      !/^--require=(electron|sdk|helper)(,(electron|sdk|helper))*$/.test(
        args[0],
      ))
  )
    throw new Error(
      "Expected --require=electron,sdk,helper (choose needed components)",
    );
  checkWritableDirectories(env);
  const required = args[0]?.slice("--require=".length).split(",") ?? [];
  const sdk = existsSync(".tools/dotnet/dotnet.exe")
    ? resolve(".tools/dotnet/dotnet.exe")
    : "dotnet";
  const result = spawnSync(sdk, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    env: {
      ...env,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    },
  });
  const sdkPolicy = JSON.parse(readFileSync("global.json", "utf8")).sdk;
  const expectedSdk = sdkPolicy.version;
  // The host resolves global.json, including rollForward; exact equality rejects valid patches.
  const resolvedSdk =
    result.status === 0 &&
    /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(result.stdout.trim())
      ? result.stdout.trim()
      : null;
  const expectedElectron = JSON.parse(readFileSync("package.json", "utf8"))
    .devDependencies.electron;
  const electron =
    existsSync("node_modules/electron/dist/electron.exe") &&
    existsSync("node_modules/electron/package.json") &&
    JSON.parse(readFileSync("node_modules/electron/package.json", "utf8"))
      .version === expectedElectron;
  const components = {
    electron,
    sdk: resolvedSdk !== null,
    helper: existsSync("resources/native-helper/WindowObserver.exe"),
  };
  console.log(
    JSON.stringify({
      node: process.version,
      writableDirectories: true,
      components,
      expectedSdk,
      resolvedSdk,
      sdkRollForward: sdkPolicy.rollForward ?? "default",
      expectedElectron,
      note: "Availability only; rebuild changed sources before testing or packaging.",
    }),
  );
  process.exit(required.every((name) => components[name]) ? 0 : 1);
}
if (!Object.hasOwn(entries, tool))
  throw new Error(
    "Expected check, npm-ci, electron-install, electron-vite, electron-builder or tsc",
  );
const entry = resolve(entries[tool]);
if (!existsSync(entry))
  throw new Error("Tool is missing; run npm.cmd ci in this workspace first");
// Builder's Electron downloader reads its config, unlike electron/install.js.
const extra =
  tool === "electron-builder"
    ? [`--config.electronDownload.cache=${env.ELECTRON_CACHE}`]
    : [];
const result = spawnSync(
  process.execPath,
  [entry, ...(tool === "npm-ci" ? ["ci"] : []), ...args, ...extra],
  { env, stdio: "inherit", windowsHide: true },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

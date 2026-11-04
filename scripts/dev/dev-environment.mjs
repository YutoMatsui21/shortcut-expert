import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { resolve, join } from "node:path";

// Each child receives these values; a previous shell's environment is never required.
export function developmentEnvironment(
  root = resolve("."),
  base = process.env,
) {
  const temp = resolve(root, ".tools/test-temp");
  const electron = resolve(root, ".tools/electron-cache");
  const builder = resolve(root, ".tools/builder-cache");
  for (const directory of [temp, electron, builder])
    mkdirSync(directory, { recursive: true });
  // Downloaded builder tools use CommonJS .js files; do not inherit the app's ESM scope.
  try {
    writeFileSync(join(builder, "package.json"), '{"type":"commonjs"}\n', {
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return {
    ...base,
    TEMP: temp,
    TMP: temp,
    ELECTRON_CACHE: electron,
    electron_config_cache: electron,
    ELECTRON_BUILDER_CACHE: builder,
  };
}

export function checkWritableDirectories(env) {
  for (const directory of new Set([
    env.TEMP,
    env.ELECTRON_CACHE,
    env.ELECTRON_BUILDER_CACHE,
  ])) {
    const probe = mkdtempSync(join(directory, "write-check-"));
    const from = join(probe, "from"),
      to = join(probe, "to");
    try {
      writeFileSync(from, "fixture");
      renameSync(from, to);
    } finally {
      for (const file of [from, to]) {
        try {
          unlinkSync(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      rmdirSync(probe);
    }
  }
}

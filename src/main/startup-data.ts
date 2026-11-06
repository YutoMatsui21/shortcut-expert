import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { app } from "electron";
import type { StartupMode } from "./startup-mode.ts";

// Runs before the instance lock, as Electron derives its identity from userData.
export function configureStartupData(mode: StartupMode): void {
  if (mode.osAcceptance && !app.isPackaged) {
    console.error("V01_REQUIRES_INSTALLED_NSIS");
    app.exit(1);
  }
  if (
    mode.naturalOperation !== null &&
    (mode.fixture ||
      !app.isPackaged ||
      !process.env.COACH_TEST_DATA_DIR ||
      readdirSync(process.env.COACH_TEST_DATA_DIR).length !== 0)
  )
    throw new Error(
      "Natural acceptance requires packaged app and a new empty isolated directory",
    );
  if (mode.fixture)
    console.log(
      "COACH_IDENTITY " +
        JSON.stringify({
          packaged: app.isPackaged,
          name: app.getName(),
          userDataDirectory: basename(app.getPath("userData")),
        }),
    );
  let data: string;
  if (mode.validation) {
    if (process.env.COACH_TEST_DATA_DIR) data = process.env.COACH_TEST_DATA_DIR;
    else {
      const directory = app.isPackaged
        ? join(app.getPath("temp"), "window-shortcut-coach-tests")
        : join(app.getAppPath(), ".tools", "tests");
      mkdirSync(directory, { recursive: true });
      data = mkdtempSync(join(directory, "coach-"));
    }
  } else
    data = app.isPackaged
      ? app.getPath("userData")
      : join(app.getAppPath(), ".tools", "coach-data");
  mkdirSync(data, { recursive: true });
  app.setPath("userData", data);
}

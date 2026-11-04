import { naturalInputOperation } from "./natural-input-mode.ts";

// Secondary smoke flags only select a runner after a fixture entry was requested.
export function startupMode(argv: readonly string[]) {
  const osAcceptance = argv.includes("--os-notification-acceptance");
  const uiAcceptance = argv.includes("--ui-acceptance");
  const migration = argv.includes("--migration-smoke");
  const fixture =
    osAcceptance ||
    uiAcceptance ||
    argv.includes("--coach-smoke") ||
    argv.includes("--storage-smoke") ||
    migration;
  const naturalOperation = naturalInputOperation(argv);
  const activation = fixture && argv.includes("--activation-smoke");
  return {
    background: !fixture
      ? argv.includes("shortcut-expert-login-startup") ||
        argv.includes("--login-startup")
      : activation && argv.includes("--login-startup-smoke"),
    fixture,
    osAcceptance,
    uiAcceptance,
    naturalOperation,
    windowDiagnostics:
      !fixture &&
      naturalOperation === "ALL" &&
      argv.includes("--caption-diagnostics"),
    validation: fixture || naturalOperation !== null,
    migration,
    activation,
    activationFailure:
      activation && argv.includes("--activation-failure-smoke"),
    activationStopped:
      activation && argv.includes("--activation-stopped-smoke"),
    comparison: fixture && argv.includes("--comparison-smoke"),
    settings: argv.includes("--settings-smoke"),
    uiExit: argv.includes("--ui-acceptance-exit"),
    get showTray() {
      return (
        !fixture ||
        osAcceptance ||
        uiAcceptance ||
        (activation && argv.includes("--login-startup-smoke"))
      );
    },
    get systemNotifications() {
      return !fixture || osAcceptance;
    },
  };
}

export type StartupMode = ReturnType<typeof startupMode>;

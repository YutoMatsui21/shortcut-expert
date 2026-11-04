import { join } from "node:path";
import { app, dialog, Notification, type BrowserWindow } from "electron";
import { startupMode } from "./startup-mode.ts";
import { configureStartupData } from "./startup-data.ts";
import { runCoach, showCoach } from "./coach-app.ts";

const mode = startupMode(process.argv);
configureStartupData(mode);

async function loadWindow(window: BrowserWindow, mode: string): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged)
    await window.loadURL(process.env.ELECTRON_RENDERER_URL + "?mode=" + mode);
  else
    await window.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { mode },
    });
}

if (!app.requestSingleInstanceLock()) app.exit(1);
else {
  // Keep the presenter alive without issuing a toast. handleActivation alone does
  // not initialize Electron's Windows presenter/COM class factory on a cold boot.
  let activationPresenter: Electron.Notification | undefined;
  app.once("will-quit", () => {
    activationPresenter?.removeAllListeners();
    activationPresenter = undefined;
  });
  app
    .whenReady()
    .then(() => {
      if (mode.systemNotifications) {
        app.setAppUserModelId("local.window-shortcut-coach");
        Notification.handleActivation(() => {
          if (mode.osAcceptance) console.log("V01_ACTIVATION global");
          showCoach();
        });
        activationPresenter = new Notification();
      }
      if (!mode.background && (!mode.fixture || mode.activation)) showCoach();
      return runCoach(loadWindow, mode);
    })
    .catch(() => {
      if (!mode.fixture)
        dialog.showErrorBox(
          "起動できません",
          "安全に初期化できませんでした。アプリを終了します。保存先とWindowsの状態を確認して再起動してください。",
        );
      console.error("COACH_START_FAILED");
      app.exit(1);
    });
  app.on("second-instance", (_event, argv) => {
    if (!startupMode(argv).background) showCoach();
  });
}

import {
  app,
  type BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  screen,
  Tray,
  powerMonitor,
} from "electron";
import { join } from "node:path";
import { DurableCoach } from "../core/durable-coach.ts";
import { selectRepositoryWithRetry } from "./sqlite-repository.ts";
import { SerialQueue } from "../core/serial-queue.ts";
import { localDate } from "../core/dates.ts";
import type { Snapshot } from "../shared/coach.ts";
import { ObserverClient } from "./observer.ts";
import { StandardNotifications } from "./standard-notification.ts";
import { CoachWindow } from "./coach-window.ts";
import { registerCoachIpc } from "./coach-ipc.ts";
import { coachTrayMenu } from "./coach-tray.ts";
import type { StartupMode } from "./startup-mode.ts";
import { LoginStartup } from "./login-startup.ts";

const coachWindow = new CoachWindow();
let quitting = false;
export function showCoach(): void {
  coachWindow.show();
}

export async function runCoach(
  load: (window: BrowserWindow, mode: string) => Promise<void>,
  mode: StartupMode,
): Promise<void> {
  const { fixture } = mode;
  const validation = mode.validation
    ? new (await import("./validation-runtime.ts")).ValidationRuntime(mode)
    : undefined;
  const loginStartup = new LoginStartup(
    validation?.loginApi ??
      (process.platform === "win32" && app.isPackaged && !mode.validation
        ? app
        : null),
    process.execPath,
  );
  const withStartup = (snapshot: Snapshot): Snapshot => ({
    ...snapshot,
    loginStartup: loginStartup.read(),
  });
  const currentSnapshot = () =>
    coachWindow.withWindowState(withStartup(coach.snapshot()));
  let tray: Tray | null = null;
  let ticker: NodeJS.Timeout | undefined;
  let errorStop = false;
  let exiting: Promise<void> | null = null;
  let exitRequested = false;
  let deleteResume: boolean | null = null;
  const control = new SerialQueue();
  const observer = new ObserverClient(
    (candidate) => {
      validation?.naturalControl?.candidate(candidate);
      void coach.accept(candidate);
    },
    () => {
      coach.fault("Windowsの観測が停止しました。再開してください。");
    },
    fixture,
    mode.windowDiagnostics
      ? (counts) => validation?.naturalControl?.nativeDiagnostics(counts)
      : undefined,
  );
  const standardNotices = new StandardNotifications(
    () => {
      validation?.activated();
      showCoach();
    },
    (result) => {
      validation?.notificationResult(result);
      if (result.status === "failed" || result.status === "unknown")
        console.error("COACH_NOTIFICATION_" + result.status.toUpperCase());
    },
    validation?.createNotification,
  );
  app.once("will-quit", () => standardNotices.dispose());
  const publish = (snapshot: Snapshot) => {
    validation?.naturalControl?.observe(snapshot);
    coachWindow.publish(withStartup(snapshot));
    if (tray) {
      tray.setToolTip(
        snapshot.error
          ? "確認が必要です"
          : snapshot.observing
            ? snapshot.notificationsPaused
              ? "記録中・通知停止"
              : "記録中"
            : "全停止",
      );
      tray.setContextMenu(
        Menu.buildFromTemplate(
          coachTrayMenu(snapshot, command, showCoach, quit),
        ),
      );
    }
    if (snapshot.error && !errorStop) {
      errorStop = true;
      void observer.stop().catch(() => {});
    }
  };
  const workerPath = join(__dirname, "storage-worker.cjs").replace(
    "app.asar",
    "app.asar.unpacked",
  );
  const common = {
    date: localDate,
    now: () => performance.now(),
    changed: publish,
  };
  const createDurableRuntime = async () => {
    const repository = await selectRepositoryWithRetry(
      app.getPath("userData"),
      workerPath,
      async () => {
        const answer = await dialog.showMessageBox({
          type: "error",
          message: "保存先を確認できません。",
          detail:
            "元のデータは変更していません。保存先へのアクセスを確認して再試行してください。",
          buttons: ["再試行", "終了"],
          defaultId: 0,
          cancelId: 1,
        });
        return answer.response === 0;
      },
    );
    const coach = new DurableCoach({
      ...common,
      repository,
      session: repository.session,
      notify: (value) => {
        validation?.naturalControl?.noticeRequested(
          value.operation,
          value.shortcut,
          value.items,
        );
        return standardNotices.show(value);
      },
      capabilities: () => validation?.capabilities() ?? [],
    });
    return {
      repository,
      coach,
      tick: () => {
        void coach.tick();
      },
    };
  };
  const { repository, coach, tick } = await createDurableRuntime();
  await validation?.prepareRepository(repository);
  const startObservation = async () => {
    if (validation && !validation.canStartObservation) return;
    if (exitRequested) return;
    const snapshot = coach.snapshot();
    if (
      snapshot.observing ||
      snapshot.pendingSave ||
      snapshot.error ||
      snapshot.settings.recordingEnabled === false
    )
      return;
    try {
      const generation = await observer.start();
      errorStop = false;
      coach.begin(generation);
      publish(coach.snapshot());
    } catch (error) {
      validation?.startFailed(error);
      coach.fault(
        error instanceof Error && error.message === "arranged-api-unavailable"
          ? "最大化判定に必要なWindows機能を取得できません。"
          : "Windowsの観測を開始できません。再開してください。",
      );
    }
  };
  const stopObservation = async () => {
    coach.stop();
    try {
      await observer.stop();
    } catch {
      coach.fault("観測の解除を確認できませんでした。再開時に初期化します。");
    }
  };
  const command = (value: string) =>
    control.run(async () => {
      if (exitRequested) return currentSnapshot();
      switch (value) {
        case "pause-notifications":
          coach.pauseNotifications(true);
          break;
        case "resume-notifications":
          coach.pauseNotifications(false);
          break;
        case "stop":
          await stopObservation();
          await coach.setRecordingEnabled(false);
          break;
        case "start":
          if (coach.snapshot().pendingSave) break;
          if (coach.snapshot().error) await coach.initialize();
          if (coach.snapshot().error) break;
          await coach.setRecordingEnabled(true);
          await startObservation();
          break;
        case "enable-startup":
        case "disable-startup":
          loginStartup.set(value === "enable-startup");
          publish(coach.snapshot());
          break;
        case "retry-save":
          await coach.retrySave();
          if (
            deleteResume !== null &&
            !coach.snapshot().error &&
            !coach.snapshot().pendingSave
          ) {
            const resume = deleteResume;
            deleteResume = null;
            if (resume) await startObservation();
          }
          break;
        case "quit":
          break;
        default:
          throw new Error("Unknown command.");
      }
      return currentSnapshot();
    });
  const performQuit = async () => {
    exitRequested = true;
    // Drain earlier UI commands before stopping; prevent a queued start from reattaching hooks.
    await control.run(async () => {});
    await stopObservation();
    await coachWindow.flush(true);
    await coach.idle();
    const window = coachWindow.current;
    if (coach.snapshot().pendingSave && window) {
      const answer =
        validation?.quitResponse != null
          ? { response: validation.quitResponse }
          : await dialog.showMessageBox(window, {
              type: "warning",
              message: "未保存の記録または設定があります。",
              detail: "終了すると未保存分は失われます。",
              buttons: ["戻る", "未保存のまま終了"],
              defaultId: 0,
              cancelId: 0,
            });
      if (answer.response !== 1) {
        exitRequested = false;
        coachWindow.resumeBounds();
        showCoach();
        return;
      }
    }
    await coach.idle();
    await observer.shutdown();
    await repository.close();
    clearInterval(ticker);
    quitting = true;
    tray?.destroy();
    app.quit();
  };
  const quit = (): Promise<void> => {
    if (quitting) return Promise.resolve();
    if (!exiting)
      exiting = performQuit()
        .catch(() => {
          exitRequested = false;
          coachWindow.resumeBounds();
          coach.fault(
            "終了処理を確認できませんでした。保存状態を確認して終了を再試行してください。",
          );
          showCoach();
        })
        .finally(() => {
          exiting = null;
        });
    return exiting;
  };
  const deleteCounts = () =>
    control.run(async () => {
      if (exitRequested) return currentSnapshot();
      deleteResume ??= coach.snapshot().observing;
      await stopObservation();
      await coach.deleteCounts();
      if (!coach.snapshot().error && !coach.snapshot().pendingSave) {
        const resume = deleteResume;
        deleteResume = null;
        if (resume) await startObservation();
      }
      return currentSnapshot();
    });
  registerCoachIpc(() => coachWindow.current, {
    getRecordSummary: (query) =>
      control.run(async () => {
        if (exitRequested) throw new Error("終了処理中です。");
        try {
          const today = localDate();
          return await coach.getRecordSummary(today, query);
        } catch {
          coach.storageFault(
            "記録を読み込めません。元のデータは保持しています。",
          );
          throw new Error("記録を読み込めません。");
        }
      }),
    getLearning: () =>
      control.run(async () => {
        if (exitRequested) throw new Error("終了処理中です。");
        const today = localDate();
        try {
          return await coach.getLearning(today);
        } catch {
          coach.storageFault(
            "一覧の記録を読み込めません。元のデータは保持しています。",
          );
          throw new Error("一覧を読み込めません。");
        }
      }),
    windowCommand: async (value) => {
      if (!exitRequested) coachWindow.command(value);
    },
    getRecords: async (from, to) => {
      if (exitRequested) throw new Error("終了処理中です。");
      try {
        return await repository.query(from, to);
      } catch {
        coach.storageFault(
          "保存データを読み込めません。元のデータは保持しています。",
        );
        throw new Error("記録を読み込めません。");
      }
    },
    getSnapshot: async () => {
      if (!exitRequested) await coach.tick();
      return currentSnapshot();
    },
    command: (value) =>
      value === "quit" ? quit().then(() => currentSnapshot()) : command(value),
    setLearningState: (operation, state) =>
      control.run(async () => {
        if (exitRequested) return currentSnapshot();
        await coach.setLearningState(operation, state);
        return currentSnapshot();
      }),
    deleteCounts,
  });
  await coach.initialize();
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void quit();
    }
  });
  const window = await coachWindow.create(load, () => quitting, {
    saved: coach.snapshot().settings.normalBounds,
    workAreas: () =>
      [
        screen.getPrimaryDisplay(),
        ...screen
          .getAllDisplays()
          .filter((display) => display.id !== screen.getPrimaryDisplay().id),
      ].map((display) => display.workArea),
    save: (bounds) => coach.setNormalBounds(bounds),
  });
  if (mode.showTray) {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, "icons", "icon.png")
      : join(app.getAppPath(), "build", "icon.png");

    const icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      throw new Error(`トレイアイコンを読み込めません: ${iconPath}`);
    }

    tray = new Tray(icon);
    tray.on("double-click", showCoach);
    const snapshot = coach.snapshot();
    if (!mode.background && (!snapshot.settings.opened || snapshot.error)) {
      showCoach();
      if (!snapshot.error) await coach.opened();
    }
  }
  window.on("focus", () => publish(coach.snapshot()));
  if (mode.naturalOperation === null) await startObservation();
  publish(coach.snapshot());
  ticker = setInterval(() => {
    if (exitRequested) return;
    tick();
  }, 1000);
  app.once("will-quit", () => clearInterval(ticker));
  powerMonitor.on("suspend", () => {
    if (coach.snapshot().observing) {
      coach.fault("スリープで観測が中断しました。再開してください。");
    }
  });
  const displaysChanged = () => {
    coachWindow.correctBounds();
  };
  screen.on("display-added", displaysChanged);
  screen.on("display-removed", displaysChanged);
  screen.on("display-metrics-changed", displaysChanged);
  await validation?.run({
    coach,
    observer,
    window,
    repository,
    workerPath,
    standardNotices,
    command,
    startObservation,
    stopObservation,
    quit,
    showCoach,
    control,
    get ticker() {
      return ticker;
    },
    get quitting() {
      return quitting;
    },
    set quitting(value) {
      quitting = value;
    },
    get exitRequested() {
      return exitRequested;
    },
  });
}

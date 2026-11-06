import { useCallback, useEffect, useRef, useState } from "react";
import { localDate } from "../../core/dates";
import type { LearningReadModel } from "../../shared/learning";
import { defaultRecordsQuery, type RecordsQuery } from "../../shared/records";
import { DeleteDialog } from "./DeleteDialog";
import { Icon } from "./icons";
import { LearningPage, LearningSummary } from "./LearningPage";
import { RecordsPage } from "./RecordsPage";
import { SaveErrorBanner } from "./SaveErrorBanner";
import { SettingsPopover } from "./SettingsPopover";
import { useCoach } from "./useCoach";

export function CoachApp() {
  const coach = useCoach();
  const [page, setPage] = useState<"learning" | "records">("learning");
  const [recordsQuery, setRecordsQuery] = useState<RecordsQuery>({
    ...defaultRecordsQuery,
  });
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [model, setModel] = useState<LearningReadModel>();
  const [readError, setReadError] = useState(false);
  const [day, setDay] = useState(localDate());
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (coach.snapshot?.windowMaximized !== undefined)
      setMaximized(coach.snapshot.windowMaximized);
  }, [coach.snapshot?.windowMaximized]);
  const gear = useRef<HTMLButtonElement>(null);
  const closeDelete = useCallback(() => {
    setDeleting(false);
    gear.current?.focus();
  }, []);
  const closeSettings = useCallback(() => {
    if (settings) {
      setSettings(false);
      gear.current?.focus();
    }
  }, [settings]);
  const changePage = (next: typeof page) => {
    closeSettings();
    setPage(next);
  };
  useEffect(() => {
    const timer = setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    void window.coach.getLearning().then(
      (value) => {
        if (active) {
          setModel(value);
          setReadError(false);
        }
      },
      () => {
        if (active) {
          setModel(undefined);
          setReadError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [coach.snapshot, day]);
  const windowAction = (value: "minimize" | "maximize" | "hide") => {
    closeSettings();
    void window.coach.windowCommand(value);
  };
  return (
    <div className="app-shell">
      <div className="titlebar">
        <div className="caption">
          <Icon name="imgAppIconKeyboardOutlineTransparent" />
          <span>Shortcut Expert</span>
        </div>
        <div className="window-controls">
          <button
            ref={gear}
            className="gear-button"
            aria-label="設定"
            aria-haspopup="dialog"
            aria-controls="settings-panel"
            aria-busy={coach.busy}
            aria-expanded={settings}
            onClick={() => (settings ? closeSettings() : setSettings(true))}
          >
            <Icon name="imgGroup" />
          </button>
          <button aria-label="最小化" onClick={() => windowAction("minimize")}>
            <Icon name="imgMinus" />
          </button>
          <button
            aria-label={maximized ? "復元" : "最大化"}
            onClick={() => windowAction("maximize")}
          >
            {maximized ? (
              <svg className="icon" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z"
                  fill="none"
                  stroke="currentColor"
                />
              </svg>
            ) : (
              <Icon name="imgSquare" />
            )}
          </button>
          <button aria-label="閉じる" onClick={() => windowAction("hide")}>
            <Icon name="imgXmark" />
          </button>
        </div>
      </div>
      <nav className="navigation-rail" aria-label="ページ">
        <button
          aria-label="ショートカット一覧"
          title="ショートカット一覧"
          aria-current={page === "learning" ? "page" : undefined}
          onClick={() => changePage("learning")}
        >
          <Icon name="imgIconBookOpen" />
        </button>
        <button
          aria-label="記録"
          title="記録"
          aria-current={page === "records" ? "page" : undefined}
          onClick={() => changePage("records")}
        >
          <Icon name="imgIconChart" />
        </button>
      </nav>
      <div className="page-frame" hidden={page !== "learning"}>
        <header className="page-header content-width">
          <div>
            <h1>ショートカット一覧</h1>
            <p>学習中の操作をマウスで行うと、ショートカットを通知します。</p>
          </div>
          <LearningSummary model={model} />
        </header>
        <SaveErrorBanner
          snapshot={coach.snapshot}
          busy={coach.busy}
          retry={() => {
            void coach.command("retry-save");
          }}
          message={coach.message ?? undefined}
          fallback={
            readError
              ? {
                  message: "一覧を読み込めません。保存データは保持しています。",
                  kind: "storage",
                }
              : undefined
          }
        />
        <main
          className="page-scroll content-width"
          aria-label="ショートカット一覧の本文"
        >
          <LearningPage
            model={model}
            busy={coach.busy}
            change={coach.setLearningState}
            collapsed={collapsed}
            toggle={(group) =>
              setCollapsed((value) =>
                value.includes(group)
                  ? value.filter((id) => id !== group)
                  : [...value, group],
              )
            }
          />
        </main>
      </div>
      <div className="records-frame" hidden={page !== "records"}>
        <RecordsPage
          coach={coach}
          query={recordsQuery}
          changeQuery={setRecordsQuery}
        />
      </div>
      {settings && (
        <SettingsPopover
          gear={gear}
          snapshot={coach.snapshot}
          busy={coach.busy}
          command={coach.command}
          close={closeSettings}
          deleteCounts={() => setDeleting(true)}
        />
      )}
      {deleting && (
        <DeleteDialog close={closeDelete} confirm={coach.deleteCounts} />
      )}
    </div>
  );
}

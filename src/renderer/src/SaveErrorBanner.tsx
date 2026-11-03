import type { Snapshot, SnapshotErrorKind } from "../../shared/coach";
import alertIcon from "./assets/imgSaveErrorAlert.svg";

export function SaveErrorBanner({
  snapshot,
  busy,
  retry,
  message: commandMessage,
  fallback,
}: {
  snapshot?: Snapshot;
  busy: boolean;
  retry(): void;
  message?: string;
  fallback?: { message: string; kind: SnapshotErrorKind };
}) {
  const message = snapshot?.error ?? commandMessage ?? fallback?.message;
  const kind = snapshot?.errorKind ?? fallback?.kind;
  if (!message) return null;
  const retryable =
    snapshot?.canRetrySave ||
    snapshot?.pendingSave ||
    kind === "storage" ||
    kind === "record-save" ||
    kind === "settings-save";
  const heading =
    kind === "record-save"
      ? "記録を保存できませんでした"
      : kind === "settings-save"
        ? "設定を保存できませんでした"
        : kind === "storage"
          ? "保存データを読み込めませんでした"
          : message;
  return (
    <div
      className="save-error-banner content-width"
      role="alert"
      data-error-kind={kind ?? "unknown"}
    >
      <span className="save-error-icon" aria-hidden="true">
        <img src={alertIcon} alt="" />
        <span>!</span>
      </span>
      <span className="save-error-message" title={message} aria-label={message}>
        {heading}
      </span>
      {retryable && (
        <button disabled={busy} onClick={retry}>
          再試行
        </button>
      )}
    </div>
  );
}

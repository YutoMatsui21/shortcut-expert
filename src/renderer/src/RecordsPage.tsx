import { Fragment, useEffect, useState } from "react";
import { localDate } from "../../core/dates";
import { learningOperations } from "../../shared/learning";
import { learningState } from "../../shared/learning";
import {
  isRecordsQuery,
  type RecordsQuery,
  type RecordsReadModel,
} from "../../shared/records";
import { Icon } from "./icons";
import { SaveErrorBanner } from "./SaveErrorBanner";
import { useCoach } from "./useCoach";

const count = (value: number | null | undefined) =>
  value == null ? "ー" : value.toLocaleString("ja-JP") + "回";
const rate = (value: number | null | undefined) =>
  value == null ? "ー" : value.toFixed(1) + "%";
const difference = (value: number | null | undefined, points = false) =>
  value == null
    ? "ー"
    : (value > 0 ? "+" : "") +
      (points ? value.toFixed(1) + "pt" : value.toLocaleString("ja-JP"));
function Comparison({
  value,
  label,
  points = false,
}: {
  value: number | null;
  missing: boolean;
  label: string;
  points?: boolean;
}) {
  return (
    <span className="comparison-value" aria-label={label}>
      <span
        data-comparison={points ? "improvement" : "count"}
        data-direction={points && value !== null ? Math.sign(value) : undefined}
      >
        {difference(value, points)}
      </span>
    </span>
  );
}
function RateBar({
  value,
  primary = false,
}: {
  value: number | null;
  primary?: boolean;
}) {
  return (
    <div
      className={"record-rate-bar" + (primary ? " primary" : "")}
      data-known={value !== null}
      aria-hidden="true"
    >
      {value !== null && <span style={{ width: value + "%" }} />}
    </div>
  );
}
function RateHelp() {
  return (
    <span
      className="help"
      tabIndex={0}
      role="note"
      aria-label="キー率の計算方法"
    >
      <Icon name="imgHelpIconHover" />
      <span className="tooltip">
        キー操作回数
        ÷（キー操作回数＋マウス操作回数）。記録なしと0%は区別します。
      </span>
    </span>
  );
}
export function RecordsPage({
  coach,
  query,
  changeQuery,
}: {
  coach: ReturnType<typeof useCoach>;
  query: RecordsQuery;
  changeQuery(value: RecordsQuery): void;
}) {
  const [day, setDay] = useState(localDate());
  const [result, setResult] = useState<RecordsReadModel>();
  const [readError, setReadError] = useState(false);
  // Window state/bounds publications must not discard rows and reset the scroll position.
  const selection = JSON.stringify(
    learningOperations.map((operation) =>
      coach.snapshot
        ? learningState(coach.snapshot.settings, operation.id)
        : null,
    ),
  );
  const recordsVersion =
    coach.snapshot?.revision ?? JSON.stringify(coach.snapshot?.counts);
  useEffect(() => {
    const timer = setInterval(() => setDay(localDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    void window.coach.getRecordSummary(query).then(
      (value) => {
        if (active) {
          setResult(value);
          setReadError(false);
        }
      },
      () => {
        if (active) {
          setResult(undefined);
          setReadError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [
    query,
    day,
    recordsVersion,
    coach.snapshot?.error,
    coach.snapshot?.canRetrySave,
    selection,
  ]);
  const model =
    result?.to === day &&
    result.query.period === query.period &&
    result.query.filter === query.filter &&
    result.query.sort === query.sort &&
    result.revision >= (coach.snapshot?.revision ?? 0)
      ? result
      : undefined;
  const choose = (field: keyof RecordsQuery, value: string) => {
    const next = {
      ...query,
      [field]: field === "period" ? Number(value) : value,
    };
    if (isRecordsQuery(next)) changeQuery(next);
  };
  return (
    <div className="records-page">
      <header className="records-header content-width">
        <h1>記録</h1>
        <div className="records-scope">
          <label>
            期間
            <select
              aria-label="期間"
              value={query.period}
              onChange={(e) => choose("period", e.target.value)}
            >
              <option value={7}>直近7日間</option>
              <option value={30}>直近30日間</option>
            </select>
          </label>
          <label>
            集計対象
            <select
              aria-label="集計対象"
              value={query.filter}
              onChange={(e) => choose("filter", e.target.value)}
            >
              <option value="learning-mastered">学習中・習得済み</option>
              <option value="learning">学習中のみ</option>
              <option value="all">すべて</option>
            </select>
          </label>
        </div>
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
                message: "記録を読み込めません。保存データは保持しています。",
                kind: "storage",
              }
            : undefined
        }
      />
      <main
        className="records-scroll content-width"
        aria-label={`直近${query.period}日間の観測記録`}
        aria-busy={!model && !readError}
      >
        <section
          className="record-kpis"
          aria-label={`${query.period}日間の集計`}
        >
          <div className="record-usage">
            <p>ショートカット使用率</p>
            <div className="record-value-line">
              <strong data-kpi="rate" data-empty={model?.summary.total === 0}>
                {model?.summary.total === 0
                  ? "記録なし"
                  : rate(model?.summary.rate)}
              </strong>
              {model && (
                <Comparison
                  value={model.comparison.improvement}
                  missing={model.comparison.hasMissingCoverage}
                  label="ショートカット使用率の前期間比"
                  points
                />
              )}
            </div>
            <RateBar value={model?.summary.barRate ?? null} primary />
          </div>
          <div className="record-counts">
            <p>操作回数</p>
            <dl>
              <div>
                <dt>ショートカット</dt>
                <dd>
                  <span data-kpi="key">{count(model?.summary.key)}</span>
                  {model && (
                    <span className="count-comparison">
                      （
                      <Comparison
                        value={model.comparison.key}
                        missing={model.comparison.hasMissingCoverage}
                        label="ショートカット回数の前期間比"
                      />
                      ）
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>マウス</dt>
                <dd>
                  <span data-kpi="mouse">{count(model?.summary.mouse)}</span>
                  {model && (
                    <span className="count-comparison">
                      （
                      <Comparison
                        value={model.comparison.mouse}
                        missing={model.comparison.hasMissingCoverage}
                        label="マウス回数の前期間比"
                      />
                      ）
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </section>
        <div className="record-table-heading">
          <h2>操作別</h2>
          <span className="compact-help">
            <RateHelp />
          </span>
          <label className="record-sort">
            <span className="visually-hidden">並び替え</span>
            <select
              aria-label="並び替え"
              value={query.sort}
              onChange={(e) => choose("sort", e.target.value)}
            >
              <option value="rate">キー率が低い順</option>
              <option value="mouse">マウス操作が多い順</option>
              <option value="improvement">改善が大きい順</option>
              <option value="key">キー操作が多い順</option>
              <option value="total">操作回数が多い順</option>
            </select>
          </label>
          <span className="record-period">
            {model ? model.from + " 〜 " + model.to : "読み込み中"}
          </span>
        </div>
        {model?.summary.total === null && (
          <p className="records-empty" role="status">
            {model.rows.length === 0
              ? "集計対象の操作はありません。"
              : "この期間の記録はありません。"}
          </p>
        )}
        <table className="record-table">
          <thead>
            <tr>
              <th>操作</th>
              <th>ショートカット</th>
              <th>
                キー率 <RateHelp />
              </th>
              <th>
                前期間比{" "}
                <span
                  className="help"
                  tabIndex={0}
                  role="note"
                  aria-label="前期間比について"
                >
                  <Icon name="imgInfoIcon" />
                  <span className="tooltip">直前の7日間との差です。</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {model?.rows.map((row) => {
              const operation = learningOperations.find(
                (operation) => operation.id === row.id,
              )!;
              return (
                <tr key={operation.id} data-operation={operation.id}>
                  <th scope="row">
                    <span>{operation.label}</span>
                  </th>
                  <td className="record-shortcut">
                    <div
                      className="shortcut-keys"
                      aria-label={operation.hint ?? operation.keys.join(" + ")}
                      title={operation.hint}
                    >
                      {operation.keys.map((key, i) => (
                        <Fragment key={key}>
                          {i > 0 && <span className="key-plus">+</span>}
                          <kbd>{key}</kbd>
                        </Fragment>
                      ))}
                    </div>
                  </td>
                  <td className="record-rate">
                    <span className="compact-rate-label">キー率 </span>
                    <span>{row.total === 0 ? "記録なし" : rate(row.rate)}</span>
                    {row.total !== null && row.total > 0 && (
                      <span className="record-fraction">
                        （{row.key}/{row.total}）
                      </span>
                    )}
                    <RateBar value={row?.barRate ?? null} />
                    <span className="visually-hidden">
                      マウス <span data-kind="mouse">{row?.mouse ?? "ー"}</span>
                      回、キー <span data-kind="key">{row?.key ?? "ー"}</span>回
                    </span>
                  </td>
                  <td className="record-comparison">
                    <Comparison
                      value={row.comparison.improvement}
                      missing={row.comparison.hasMissingCoverage}
                      label={operation.label + "の前期間比"}
                      points
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}

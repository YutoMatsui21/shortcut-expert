import { Fragment, useEffect, useState } from 'react';
import type { RecordsReadModel } from '../../shared/records';
import { learningOperations } from '../../shared/learning';
import { localDate } from '../../core/dates';
import { useCoach } from './useCoach';
import { Icon } from './icons';

const count = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('ja-JP') + '回';
const rate = (value: number | null | undefined) => value == null ? '—' : value.toFixed(1) + '%';
function RateBar({ value, primary = false }: { value: number | null; primary?: boolean }) {
  return <div className={'record-rate-bar' + (primary ? ' primary' : '')} data-known={value !== null} aria-hidden="true">
    {value !== null && <span style={{ width: value + '%' }} />}
  </div>;
}
function RateHelp() {
  return <span className="help" tabIndex={0} role="note" aria-label="キー率の計算方法"><Icon name="imgHelpIconHover" />
    <span className="tooltip">キー操作回数 ÷（キー操作回数＋マウス操作回数）。記録なしと0%は区別します。</span></span>;
}
export function RecordsPage({ coach }: { coach: ReturnType<typeof useCoach> }) {
  const [day, setDay] = useState(localDate());
  const [result, setResult] = useState<RecordsReadModel>();
  const [readError, setReadError] = useState(false);
  useEffect(() => { const timer = setInterval(() => setDay(localDate()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    void window.coach.getRecordSummary().then(value => {
      if (active) { setResult(value); setReadError(false); }
    }, () => { if (active) { setResult(undefined); setReadError(true); } });
    return () => { active = false; };
  }, [day, coach.snapshot?.revision, coach.snapshot?.error, coach.snapshot?.settings]);
  const model = result?.to === day && result.revision >= (coach.snapshot?.revision ?? 0) ? result : undefined;
  return <div className="records-page">
    <header className="records-header content-width"><h1>記録</h1>
      <div className="records-scope"><span>期間 <strong>直近7日間</strong></span><span>集計対象 <strong>すべての操作</strong></span></div>
    </header>
    {(readError || coach.snapshot?.error || coach.message) && <div className="error content-width" role="alert">
      {coach.snapshot?.error ?? coach.message ?? '記録を読み込めません。'}
      {coach.snapshot?.pendingSave && <button disabled={coach.busy} onClick={() => coach.command('retry-save')}>保存を再試行</button>}
    </div>}
    <main className="records-scroll content-width" aria-label="直近7日間の観測記録" aria-busy={!model && !readError}>
      <section className="record-kpis" aria-label="7日間の集計">
        <div className="record-usage"><p>ショートカット使用率</p><strong data-kpi="rate">{rate(model?.summary.rate)}</strong>
          <RateBar value={model?.summary.barRate ?? null} primary /></div>
        <div className="record-counts"><p>操作回数</p><dl>
          <div><dt>ショートカット</dt><dd data-kpi="key">{count(model?.summary.key)}</dd></div>
          <div><dt>マウス</dt><dd data-kpi="mouse">{count(model?.summary.mouse)}</dd></div>
        </dl></div>
      </section>
      <div className="record-table-heading"><h2>操作別</h2><span className="compact-help"><RateHelp /></span>
        <span className="record-period">{model ? model.from + ' 〜 ' + model.to : '読み込み中'}</span></div>
      {model?.summary.total === null && <p className="records-empty" role="status">この期間の記録はありません。</p>}
      <table className="record-table"><thead><tr><th>操作</th><th>ショートカット</th><th>キー率 <RateHelp /></th><th>前期間比</th></tr></thead>
        <tbody>{learningOperations.map(operation => {
          const row = model?.rows.find(row => row.id === operation.id);
          return <tr key={operation.id} data-operation={operation.id}>
            <th scope="row"><span>{operation.label}</span><span className="availability">準備中</span></th>
            <td className="record-shortcut"><div className="shortcut-keys" aria-label={operation.hint ?? operation.keys.join(' + ')} title={operation.hint}>
              {operation.keys.map((key, i) => <Fragment key={key}>{i > 0 && <span className="key-plus">+</span>}<kbd>{key}</kbd></Fragment>)}
            </div></td>
            <td className="record-rate"><span className="compact-rate-label">キー率 </span><span>{rate(row?.rate)}</span>
              {row?.total != null && <span className="record-fraction">（{row.key}/{row.total}）</span>}
              <RateBar value={row?.barRate ?? null} />
              <span className="visually-hidden">マウス <span data-kind="mouse">{row?.mouse ?? '—'}</span>回、キー <span data-kind="key">{row?.key ?? '—'}</span>回</span>
            </td>
            <td className="record-comparison" aria-label="前期間比は準備中">—</td>
          </tr>;
        })}</tbody>
      </table>
      <p className="footnote">取得した記録を表示しています。観測の根拠がない項目は「—」です。12操作とも検出精度は未検証です。前期間との比較は準備中です。</p>
    </main>
  </div>;
}

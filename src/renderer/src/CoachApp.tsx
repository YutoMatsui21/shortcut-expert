import { useEffect, useRef, useState } from 'react';
import type { RecordRange } from '../../shared/storage';
import { localDate as today } from '../../core/dates';
import { operations } from '../../shared/coach';
import { useCoach } from './useCoach';

export function CoachApp() {
  const { snapshot, busy, message, command, setMuted, deleteCounts } = useCoach();
  const [day, setDay] = useState(today());
  const priorToday = useRef(today());
  useEffect(() => {
    const current = today();
    if (day === priorToday.current && current !== priorToday.current) setDay(current);
    priorToday.current = current;
  }, [snapshot?.revision, day]);
  const [queried, setQueried] = useState<{ day: string; value: RecordRange } | null>(null);
  useEffect(() => {
    let current = true;
    if (snapshot?.coverage && !snapshot.error && window.coach.getRecords) {
      void window.coach.getRecords(day, day).then(value => { if (current) setQueried({ day, value }); }, () => { if (current) setQueried(null); });
    }
    return () => { current = false; };
  }, [day, snapshot?.revision, snapshot?.error]);
  const dates = [...new Set([today(), ...Object.keys(snapshot?.counts ?? {})])].sort().reverse();
  const selected = snapshot?.coverage ? day : dates.includes(day) ? day : today();
  const view = queried?.day === selected && queried.value.revision >= (snapshot?.revision ?? 0) ? queried.value : snapshot;
  const counts = view?.counts[selected] ?? {};
  const known = (id: import('../../shared/coach').OperationId) => !snapshot?.coverage || !!counts[id] || view?.coverage?.[selected]?.[id]?.knowledge === 'observed';
  const visible = operations.filter(op => !snapshot?.coverage || op.id !== 'W09');
  const anyKnown = visible.some(op => known(op.id));
  const total = visible.reduce((sum, op) => ({ mouse: sum.mouse + (counts[op.id]?.mouse ?? 0), key: sum.key + (counts[op.id]?.key ?? 0) }), { mouse: 0, key: 0 });
  const paused = snapshot?.notificationsPaused ?? false;
  const observing = snapshot?.observing ?? false;
  return <main className="dashboard">
    <header><div><p className="eyebrow">WINDOW SHORTCUT COACH</p><h1>今日の操作、次はキーで。</h1></div>
      <span className={'badge ' + (observing ? 'running' : 'stopped')}>{observing ? paused ? '記録中 · 通知停止' : '記録中' : '全停止'}</span></header>
    <p className="intro">別画面への移動・最大化・最小化・最大化からの復元・閉じる操作を記録します。成立条件を確認できた観測だけを数えます。</p>
    {snapshot?.coverage && <p className="footnote">検出精度は未検証です。取得した記録を表示し、観測の根拠がない項目は「—」と表示します。</p>}
    <div className="controls">
      <button disabled={busy || !snapshot || !observing} onClick={() => command(paused ? 'resume-notifications' : 'pause-notifications')}>{paused ? '通知を再開' : '通知を停止'}</button>
      <button className="secondary" disabled={busy || !snapshot || (!observing && snapshot.pendingSave)} onClick={() => command(observing ? 'stop' : 'start')}>{observing ? '計測を全停止' : '計測を再開'}</button>
      <span>画面を閉じても記録を続けます。</span>
    </div>
    {(snapshot?.error || message) && <div className="error" role="alert"><p>{snapshot?.error ?? message}</p>
      {snapshot?.pendingSave && <><p>{snapshot.coverage ? '未保存または保存結果を確認できていない記録があります。' : '表示中の数値には未保存分があります。'}</p><button disabled={busy} onClick={() => command('retry-save')}>保存を再試行</button></>}
    </div>}
    <section className="records" aria-label="日別の観測記録">
      <div className="record-head"><h2>{selected === today() ? '今日の記録' : '保存した記録'}</h2>
        <label>日付{snapshot?.coverage ? <input type="date" value={selected} max={today()} onChange={event => { if (event.target.value) setDay(event.target.value); }} /> : <select value={selected} onChange={(event) => setDay(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{date}</option>)}</select>}</label></div>
      <div className="totals"><div><span>マウス操作</span><strong>{anyKnown ? total.mouse : '—'}<small>回</small></strong></div><div><span>キー操作</span><strong>{anyKnown ? total.key : '—'}<small>回</small></strong></div></div>
      <table><thead><tr><th>操作</th><th>マウス</th><th>キー</th><th>通知</th></tr></thead><tbody>
        {visible.map((op) => <tr key={op.id} data-operation={op.id} className={op.implemented ? '' : 'upcoming'}>
          <th scope="row">{op.label} <span className="shortcut">（{op.shortcut}）</span>{!op.implemented && <span className="prepared">準備中</span>}
            {op.condition && <small className="shortcut-condition">{op.condition}</small>}</th>
          <td data-kind="mouse">{known(op.id) ? counts[op.id]?.mouse ?? 0 : '—'}</td><td data-kind="key">{known(op.id) ? counts[op.id]?.key ?? 0 : '—'}</td>
          <td><label className="toggle"><input aria-label={op.label + 'の通知'} type="checkbox" disabled={busy || !snapshot || !op.implemented}
            checked={op.implemented && !snapshot?.settings.muted.includes(op.id)}
            onChange={(event) => void setMuted(op.id, !event.target.checked)} /><span>{op.implemented ? snapshot?.settings.muted.includes(op.id) ? 'OFF' : 'ON' : '—'}</span></label></td>
        </tr>)}
      </tbody></table>
      <p className="footnote">通知を止めても記録は続きます。観測数は全操作の実行回数や習得率を表しません。</p>
    </section>
    <footer><button className="text-button danger" disabled={busy || !snapshot} onClick={() => void deleteCounts()}>全日分の記録を削除</button>
      <button className="text-button" disabled={busy} onClick={() => command('quit')}>アプリを終了</button></footer>
  </main>;
}


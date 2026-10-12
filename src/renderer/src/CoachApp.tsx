import { useEffect, useState } from 'react';
import { localDate as today } from '../../core/dates';
import { operations, type CoachBridge, type Snapshot } from '../../shared/coach';

export function CoachApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const receive = (next: Snapshot) => { if (active) setSnapshot(next); };
    const unsubscribe = window.coach.subscribe(receive);
    void window.coach.getSnapshot().then(receive).catch(() => setMessage('状態を取得できません。アプリを再起動してください。'));
    return () => { active = false; unsubscribe(); };
  }, []);
  const act = async (action: () => Promise<Snapshot>) => {
    setBusy(true); setMessage(null);
    try { setSnapshot(await action()); } catch { setMessage('操作を完了できませんでした。もう一度お試しください。'); }
    finally { setBusy(false); }
  };
  const command = (value: Parameters<CoachBridge['command']>[0]) => act(() => window.coach.command(value));
  const dates = [...new Set([today(), ...Object.keys(snapshot?.counts ?? {})])].sort().reverse();
  const selected = dates.includes(day) ? day : today();
  const counts = snapshot?.counts[selected] ?? {};
  const total = Object.values(counts).reduce((sum, value) => ({ mouse: sum.mouse + (value?.mouse ?? 0), key: sum.key + (value?.key ?? 0) }), { mouse: 0, key: 0 });
  const paused = snapshot?.notificationsPaused ?? false;
  const observing = snapshot?.observing ?? false;
  return <main className="dashboard">
    <header><div><p className="eyebrow">WINDOW SHORTCUT COACH</p><h1>今日の操作、次はキーで。</h1></div>
      <span className={'badge ' + (observing ? 'running' : 'stopped')}>{observing ? paused ? '記録中 · 通知停止' : '記録中' : '全停止'}</span></header>
    <p className="intro">現在の記録対象は最大化の標準経路です。成立条件を確認できた観測だけを数えます。</p>
    <div className="controls">
      <button disabled={busy || !snapshot} onClick={() => command(paused ? 'resume-notifications' : 'pause-notifications')}>{paused ? '通知を再開' : '通知を停止'}</button>
      <button className="secondary" disabled={busy || !snapshot || (!observing && snapshot.pendingSave)} onClick={() => command(observing ? 'stop' : 'start')}>{observing ? '計測を全停止' : '計測を再開'}</button>
      <span>画面を閉じても記録を続けます。</span>
    </div>
    {(snapshot?.error || message) && <div className="error" role="alert"><p>{snapshot?.error ?? message}</p>
      {snapshot?.pendingSave && <><p>表示中の数値には未保存分があります。</p><button disabled={busy} onClick={() => command('retry-save')}>保存を再試行</button></>}
    </div>}
    <section className="records" aria-label="日別の観測記録">
      <div className="record-head"><h2>{selected === today() ? '今日の記録' : '保存した記録'}</h2>
        <label>日付<select value={selected} onChange={(event) => setDay(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{date}</option>)}</select></label></div>
      <div className="totals"><div><span>マウス操作</span><strong>{total.mouse}<small>回</small></strong></div><div><span>キー操作</span><strong>{total.key}<small>回</small></strong></div></div>
      <table><thead><tr><th>操作</th><th>マウス</th><th>キー</th><th>通知</th></tr></thead><tbody>
        {operations.map((op) => <tr key={op.id} data-operation={op.id} className={op.implemented ? '' : 'upcoming'}>
          <th scope="row">{op.label}{!op.implemented && <span className="prepared">準備中</span>}</th>
          <td data-kind="mouse">{counts[op.id]?.mouse ?? 0}</td><td data-kind="key">{counts[op.id]?.key ?? 0}</td>
          <td><label className="toggle"><input aria-label={op.label + 'の通知'} type="checkbox" disabled={busy || !snapshot || !op.implemented}
            checked={op.implemented && !snapshot?.settings.muted.includes(op.id)}
            onChange={(event) => void act(() => window.coach.setMuted(op.id, !event.target.checked))} /><span>{op.implemented ? snapshot?.settings.muted.includes(op.id) ? 'OFF' : 'ON' : '—'}</span></label></td>
        </tr>)}
      </tbody></table>
      <p className="footnote">通知を止めても記録は続きます。観測数は全操作の実行回数や習得率を表しません。</p>
    </section>
    <footer><button className="text-button danger" disabled={busy || !snapshot} onClick={() => void act(() => window.coach.deleteCounts())}>全日分の記録を削除</button>
      <button className="text-button" disabled={busy} onClick={() => command('quit')}>アプリを終了</button></footer>
  </main>;
}


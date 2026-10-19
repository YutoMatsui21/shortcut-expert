import { useEffect, useRef, useState } from 'react';
import type { LearningReadModel } from '../../shared/learning';
import { localDate } from '../../core/dates';
import { useCoach } from './useCoach';
import { RecordsPage } from './RecordsPage';
import { LearningPage, LearningSummary } from './LearningPage';
import { Icon } from './icons';

export function CoachApp() {
  const coach = useCoach();
  const [page, setPage] = useState<'learning' | 'records'>('learning');
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [model, setModel] = useState<LearningReadModel>();
  const [readError, setReadError] = useState(false);
  const [day, setDay] = useState(localDate());
  const [settings, setSettings] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = setInterval(() => setDay(localDate()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    void window.coach.getLearning().then(value => { if (active) { setModel(value); setReadError(false); } }, () => { if (active) { setModel(undefined); setReadError(true); } });
    return () => { active = false; };
  }, [coach.snapshot, day]);
  useEffect(() => {
    if (!settings) return;
    const outside = (event: PointerEvent) => { if (!popover.current?.contains(event.target as Node) && !gear.current?.contains(event.target as Node)) setSettings(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettings(false); gear.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [settings]);
  const windowAction = (value: 'minimize' | 'maximize' | 'hide') => { void window.coach.windowCommand(value); };
  return <div className="app-shell">
    <div className="titlebar"><div className="caption"><Icon name="imgAppIconKeyboardOutlineTransparent" /><span>Shortcut Expert</span></div>
      <div className="window-controls"><button ref={gear} className="gear-button" aria-label="設定" aria-expanded={settings} onClick={() => setSettings(!settings)}><Icon name="imgGroup" /></button>
        <button aria-label="最小化" onClick={() => windowAction('minimize')}><Icon name="imgMinus" /></button>
        <button aria-label="最大化または復元" onClick={() => windowAction('maximize')}><Icon name="imgSquare" /></button>
        <button aria-label="閉じる" onClick={() => windowAction('hide')}><Icon name="imgXmark" /></button></div>
    </div>
    <nav className="navigation-rail" aria-label="ページ"><button aria-label="ショートカット一覧" title="ショートカット一覧" aria-current={page === 'learning' ? 'page' : undefined} onClick={() => setPage('learning')}><Icon name="imgIconBookOpen" /></button>
      <button aria-label="記録" title="記録" aria-current={page === 'records' ? 'page' : undefined} onClick={() => setPage('records')}><Icon name="imgIconChart" /></button></nav>
    <div className="page-frame" hidden={page !== 'learning'}>
      <header className="page-header content-width"><div><h1>ショートカット一覧</h1><p>学習中の操作をマウスで行うと、ショートカットを通知します。 <span className="help" tabIndex={0} role="note" aria-label="学習と記録について"><Icon name="imgInfoIcon" /><span className="tooltip">対象外でも記録は継続します。12操作とも検出精度は未検証のため準備中です。</span></span></p></div><LearningSummary model={model} /></header>
      <main className="page-scroll content-width" aria-label="ショートカット一覧の本文">
        {(readError || coach.snapshot?.error || coach.message) && <div className="error" role="alert">{coach.snapshot?.error ?? coach.message ?? '一覧を読み込めません。'}{coach.snapshot?.pendingSave && <button disabled={coach.busy} onClick={() => coach.command('retry-save')}>保存を再試行</button>}</div>}
        <LearningPage model={model} collapsed={collapsed} toggle={group => setCollapsed(value => value.includes(group) ? value.filter(id => id !== group) : [...value, group])} />
      </main>
    </div>
    <div className="records-frame" hidden={page !== 'records'}><RecordsPage coach={coach} /></div>
    {settings && <div className="settings-popover" ref={popover} role="dialog" aria-label="設定">
      <button disabled={coach.busy || !coach.snapshot?.observing} onClick={() => coach.command(coach.snapshot?.notificationsPaused ? 'resume-notifications' : 'pause-notifications')}>{coach.snapshot?.notificationsPaused ? '通知を再開' : '通知を停止'}</button>
      <button disabled={coach.busy || !coach.snapshot || (!coach.snapshot.observing && coach.snapshot.pendingSave)} onClick={() => coach.command(coach.snapshot?.observing ? 'stop' : 'start')}>{coach.snapshot?.observing ? '計測を全停止' : '計測を再開'}</button>
      <button disabled={coach.busy || !coach.snapshot} onClick={() => void coach.deleteCounts()}>すべての記録を削除…</button>
    </div>}
  </div>;
}

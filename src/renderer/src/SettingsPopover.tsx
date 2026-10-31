import { useEffect, useRef, type RefObject } from 'react';
import type { Snapshot, CoachBridge } from '../../shared/coach';
import toggleOn from './assets/imgSettingsToggleOn.svg';

type Props = {
  gear: RefObject<HTMLButtonElement | null>; snapshot?: Snapshot; busy: boolean;
  command(value: Parameters<CoachBridge['command']>[0]): unknown;
  close(): void; deleteCounts(): unknown;
};

export function SettingsPopover({ gear, snapshot, busy, command, close, deleteCounts }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const focusAssigned = useRef(false);
  const commandFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const button = commandFocus.current;
    if (!busy && button && !button.disabled) {
      commandFocus.current = null;
      if (button.isConnected && document.activeElement === document.body && document.hasFocus()) button.focus();
    }
    if (focusAssigned.current) return;
    const first = panel.current?.querySelector<HTMLButtonElement>('.settings-switch:not(:disabled)');
    if (first) { first.focus(); focusAssigned.current = true; }
  }, [busy, snapshot]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !gear.current?.contains(event.target as Node)) {
        event.preventDefault(); close();
      }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    const hidden = () => { if (document.hidden) close(); };
    const blur = () => close();
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur);
    };
  }, [gear, close]);
  const switchButton = (label: string, checked: boolean, disabled: boolean, action: Parameters<CoachBridge['command']>[0]) =>
    <button className="settings-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={event => { commandFocus.current = event.currentTarget; command(action); }}>
      {checked ? <img src={toggleOn} alt="" draggable={false} /> : <span className="settings-switch-off" />}
    </button>;
  return <div id="settings-panel" className="settings-popover" ref={panel} role="dialog" aria-labelledby="settings-title">
    <h2 id="settings-title">設定</h2>
    <div className="settings-preference"><div><span>通知</span><p>学習中のマウス操作を通知</p></div>
      {switchButton('通知', !!snapshot && !snapshot.notificationsPaused, busy || !snapshot?.observing,
        snapshot?.notificationsPaused ? 'resume-notifications' : 'pause-notifications')}</div>
    <div className="settings-preference"><div><span>計測</span><p>マウスとキーの操作を記録</p></div>
      {switchButton('計測', !!snapshot?.observing, busy || !snapshot || (!snapshot.observing && snapshot.pendingSave),
        snapshot?.observing ? 'stop' : 'start')}</div>
    <div className="settings-preference"><div><span>Windowsへのサインイン時に起動</span><p>{snapshot?.loginStartup?.available ? '画面を開かずトレイに常駐' : 'インストール済みWindows版で設定可能'}</p></div>
      {switchButton('Windowsへのサインイン時に起動', !!snapshot?.loginStartup?.enabled,
        busy || !snapshot?.loginStartup?.available || !!snapshot.pendingSave,
        snapshot?.loginStartup?.enabled ? 'disable-startup' : 'enable-startup')}</div>
    {snapshot?.loginStartup?.error && <p className="startup-error" role="alert">{snapshot.loginStartup.error}</p>}
    <div className="settings-divider" />
    <button className="settings-delete" disabled={busy || !snapshot} onClick={() => { close(); void deleteCounts(); }}>すべての記録を削除…</button>
  </div>;
}

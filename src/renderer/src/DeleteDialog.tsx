import { useEffect, useRef, useState } from 'react';

export function DeleteDialog({ close, confirm }: { close(): void; confirm(token: string): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const token = useRef<string | null>(null);
  const submitting = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dismiss = () => { dialog.current?.close(); close(); };
  useEffect(() => {
    let active = true;
    dialog.current!.showModal(); cancel.current!.focus();
    void window.coach.requestDelete().then(value => {
      if (active) { token.current = value; setReady(true); }
      else void window.coach.cancelDelete(value).catch(() => {});
    }, () => { if (active) setError(true); });
    const hide = () => { if (document.hidden && !submitting.current) { dialog.current?.close(); close(); } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      active = false; document.removeEventListener('visibilitychange', hide);
      if (token.current) void window.coach.cancelDelete(token.current).catch(() => {});
      dialog.current?.close();
    };
  }, [close]);
  return <dialog ref={dialog} className="delete-dialog" tabIndex={-1} aria-labelledby="delete-title" aria-describedby="delete-description" aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.findIndex(button => button === document.activeElement);
      (buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length] ?? dialog.current)?.focus();
    }}
    onCancel={event => { event.preventDefault(); if (!submitting.current) dismiss(); }}>
    <h2 id="delete-title">すべての記録を削除しますか？</h2>
    <p id="delete-description">削除した記録は元に戻せません。</p>
    {error && <span className="delete-error" role="alert">確認を取得できません。閉じて再試行してください。</span>}
    <footer><button ref={cancel} className="delete-cancel" disabled={busy} onClick={dismiss}>キャンセル</button>
      <button className="delete-confirm" disabled={busy || !ready} onClick={async () => {
        if (submitting.current || !token.current) return;
        submitting.current = true; setBusy(true);
        const value = token.current; token.current = null;
        await confirm(value); dismiss();
      }}>記録を削除</button></footer>
  </dialog>;
}

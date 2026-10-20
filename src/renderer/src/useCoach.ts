import { useEffect, useRef, useState } from 'react';
import type { CoachBridge, OperationId, Snapshot } from '../../shared/coach';
import { newestSnapshot } from './coach-snapshot';

export function useCoach(bridge: CoachBridge = window.coach) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef(0);
  useEffect(() => {
    let active = true;
    const receive = (next: Snapshot) => { if (active) setSnapshot(current => newestSnapshot(current, next)); };
    const unsubscribe = bridge.subscribe(receive);
    void bridge.getSnapshot().then(receive).catch(() => { if (active) setMessage('状態を取得できません。アプリを再起動してください。'); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  const act = async (action: () => Promise<Snapshot>) => {
    pending.current++; setBusy(true); setMessage(null);
    try { const next = await action(); setSnapshot(current => newestSnapshot(current, next)); } catch { setMessage('操作を完了できませんでした。もう一度お試しください。'); }
    finally { pending.current--; setBusy(pending.current > 0); }
  };
  const command = (value: Parameters<CoachBridge['command']>[0]) => act(() => bridge.command(value));
  const setMuted = (operation: OperationId, muted: boolean) => act(() => bridge.setMuted(operation, muted));
  const setLearningState = (operation: OperationId, state: Parameters<CoachBridge['setLearningState']>[1]) => act(() => bridge.setLearningState(operation, state));
  const deleteCounts = (token: string) => act(() => bridge.deleteCounts(token));
  return { snapshot, busy, message, command, setMuted, setLearningState, deleteCounts };
}

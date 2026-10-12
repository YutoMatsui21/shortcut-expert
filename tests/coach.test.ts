import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coach, notificationCooldownElapsed } from '../src/core/coach.ts';
import type { Counts, Settings, Candidate, Notice } from '../src/shared/coach.ts';

const sample: Candidate = {
  type: 'candidate', protocolVersion: 1, generation: 1, sequence: 1,
  app: 'chrome', operation: 'maximize', date: '2026-10-11',
  before: { state: 'normal', arranged: false }, after: { state: 'maximized' },
  origin: 'mouse', route: 'max-button', injected: false, conflicted: false,
  moving: false, elevated: false, targetMatched: true, inputAgeMs: 135,
  monitor: { x: 0, y: 0, width: 1920, height: 1080 }
};

function harness() {
  let counts: Counts = {};
  let settings: Settings = { muted: [], opened: false };
  let now = 0;
  let date = '2026-10-11';
  let failSave = false;
  let showNotice = true;
  const notices: Notice[] = [];
  const repository = {
    load: async () => ({ counts: structuredClone(counts), settings: structuredClone(settings) }),
    saveCounts: async (next: Counts) => { if (failSave) throw new Error('disk'); counts = structuredClone(next); },
    saveSettings: async (next: Settings) => { settings = structuredClone(next); }
  };
  const coach = new Coach({ repository, date: () => date, now: () => now,
    notify: async (notice) => { notices.push(notice); return showNotice; }, changed: () => {} });
  return { coach, notices, saved: () => counts, repository,
    clock: (value: number) => { now = value; }, date: (value: string) => { date = value; },
    fail: (value: boolean) => { failSave = value; }, showNotice: (value: boolean) => { showNotice = value; } };
}

test('設定保存失敗後の最新の正常保存を再試行で古い値へ戻さない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const save = h.repository.saveSettings;
  h.repository.saveSettings = async () => { throw new Error('settings-disk'); };
  await h.coach.setMuted('W03', true);
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.saveSettings = save;
  await h.coach.setMuted('W03', true);
  await h.coach.setMuted('W03', false);
  await h.coach.retrySave();
  assert.deepEqual((await h.repository.load()).settings.muted, []);
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().error, null);
});

test('設定だけ復旧しても未保存の記録エラーと停止状態を残す', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  h.fail(true); await h.coach.accept(sample);
  const save = h.repository.saveSettings;
  h.repository.saveSettings = async () => { throw new Error('settings-disk'); };
  await h.coach.setMuted('W03', true);
  h.repository.saveSettings = save;
  await h.coach.retrySave();
  const state = h.coach.snapshot();
  assert.equal(state.pendingSave, true);
  assert.equal(state.observing, false);
  assert.match(state.error ?? '', /記録を保存/);
  assert.deepEqual(state.settings.muted, ['W03']);
  h.fail(false); await h.coach.retrySave(); h.coach.begin(2);
  assert.equal(h.coach.snapshot().error, null);
  assert.equal(h.coach.snapshot().observing, true);
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
});

test('初回表示の設定保存失敗を未保存として示し再試行で保存する', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const save = h.repository.saveSettings;
  h.repository.saveSettings = async () => { throw new Error('settings-disk'); };
  await h.coach.opened();
  assert.equal(h.coach.snapshot().settings.opened, false);
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.saveSettings = save;
  await h.coach.retrySave();
  assert.equal((await h.repository.load()).settings.opened, true);
  assert.equal(h.coach.snapshot().pendingSave, false);
});

test('全停止中に通知停止設定を変えず再開後も元の状態を保つ', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  h.coach.pauseNotifications(true); h.coach.stop();
  h.coach.pauseNotifications(false); h.coach.begin(2);
  assert.equal(h.coach.snapshot().notificationsPaused, true);
  await h.coach.accept({ ...sample, generation: 2 });
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
  assert.equal(h.notices.length, 0);
});

test('保存中の全削除後に旧世代の候補と保留保存で記録を復活させない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.setMuted('W03', true);
  const save = h.repository.saveCounts;
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const saving = new Promise<void>((resolve) => { started = resolve; });
  h.repository.saveCounts = async (counts) => { started(); await blocked; await save(counts); };
  const accepted = h.coach.accept(sample); await saving;
  const deleted = h.coach.deleteCounts();
  const old = h.coach.accept({ ...sample, sequence: 2 });
  release(); await Promise.all([accepted, deleted, old]);
  assert.deepEqual(h.saved(), {});
  assert.deepEqual(h.coach.snapshot().settings.muted, ['W03']);
  h.coach.begin(3); await h.coach.accept({ ...sample, generation: 3 });
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
});

test('全削除の保存失敗では停止と未保存を維持し復旧後も設定を残す', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept(sample); await h.coach.setMuted('W03', true);
  h.fail(true); await h.coach.deleteCounts(); h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
  h.fail(false); await h.coach.retrySave();
  assert.deepEqual(h.saved(), {}); assert.deepEqual(h.coach.snapshot().settings.muted, ['W03']);
});

test('深夜をまたいで届いた候補は操作完了日のみに計上する', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1); h.date('2026-10-12');
  await h.coach.accept(sample);
  await h.coach.accept({ ...sample, sequence: 2, date: '2026-10-12', origin: 'key', route: 'win-up' });
  await h.coach.accept({ ...sample, sequence: 3, date: '2026-10-13' });
  assert.deepEqual(h.saved(), {
    '2026-10-11': { W03: { mouse: 1, key: 0 } }, '2026-10-12': { W03: { mouse: 0, key: 1 } }
  });
});

test('保留設定の復旧がhelper故障状態を解除しない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const save = h.repository.saveSettings;
  h.repository.saveSettings = async () => { throw new Error('fixture-settings'); };
  await h.coach.setMuted('W03', true); h.coach.fault('Windowsの観測が停止しました。');
  h.repository.saveSettings = save; await h.coach.retrySave(); h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, false);
  assert.match(h.coach.snapshot().error ?? '', /Windows/);
});

for (const delay of [1999, 2000, 2001]) {
  test(`通知候補は受信から${delay}msで期限を判定し、集計は保持する`, async () => {
    const h = harness(); await h.coach.initialize(); h.coach.begin(1);
    const save = h.repository.saveCounts;
    h.repository.saveCounts = async (value) => { h.clock(delay); await save(value); };
    await h.coach.accept(sample);
    assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 1, key: 0 } } });
    assert.equal(h.notices.length, delay < 2000 ? 1 : 0);
    if (h.notices[0]) assert.equal(h.notices[0].expiresAt, 2000);
  });
}

test('全体10秒と操作別60秒の通知間隔はそれぞれ境界を含む', () => {
  for (const [now, lastNotice, lastOperation, expected] of [
    [9999, 0, -Infinity, false], [10_000, 0, -Infinity, true], [10_001, 0, -Infinity, true],
    [59_999, -Infinity, 0, false], [60_000, -Infinity, 0, true], [60_001, -Infinity, 0, true],
    [60_000, 50_001, 0, false], [60_000, 50_000, 1, false], [60_000, 50_000, 0, true]
  ] as const) assert.equal(notificationCooldownElapsed(now, lastNotice, lastOperation), expected);
});

test('同じ操作の通知は60秒直前に抑制し、60秒ちょうどに再表示する', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept(sample);
  h.clock(59_999); await h.coach.accept({ ...sample, sequence: 2 });
  assert.equal(h.notices.length, 1);
  h.clock(60_000); await h.coach.accept({ ...sample, sequence: 3 });
  assert.equal(h.notices.length, 2);
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 3);
});

test('表示が見送られた通知は間隔を進めず、次の候補で再表示できる', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  h.showNotice(false); await h.coach.accept(sample);
  h.showNotice(true); h.clock(1); await h.coach.accept({ ...sample, sequence: 2 });
  h.clock(2); await h.coach.accept({ ...sample, sequence: 3 });
  assert.equal(h.notices.length, 2);
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 3);
});

test('除外した候補のsequenceも消費し、同じIDの別内容は受理しない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept({ ...sample, origin: 'unknown' });
  await h.coach.accept(sample);
  assert.deepEqual(h.saved(), {});
  await h.coach.accept({ ...sample, sequence: 2 });
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
});

test('保存途中の停止は集計を完了し、通知せず、新しい世代の候補を受理する', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const save = h.repository.saveCounts;
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const saving = new Promise<void>((resolve) => { started = resolve; });
  h.repository.saveCounts = async (value) => { started(); await blocked; await save(value); };
  const accepted = h.coach.accept(sample);
  await saving;
  assert.equal(h.coach.snapshot().pendingSave, true);
  h.coach.stop(); release(); await accepted;
  assert.equal(h.notices.length, 0);
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 1);
  h.coach.begin(2);
  await h.coach.accept({ ...sample, sequence: 2 });
  await h.coach.accept({ ...sample, generation: 2 });
  assert.equal(h.saved()['2026-10-11'].W03?.mouse, 2);
  assert.equal(h.notices.length, 1);
});

test('同じ観測は1回だけ保存し、mouseは通知、keyは数値だけ更新する', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept(sample); await h.coach.accept(sample);
  await h.coach.accept({ ...sample, sequence: 2, origin: 'key', route: 'win-up' });
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 1, key: 1 } } });
  assert.equal(h.notices.length, 1);
});

test('スナップからの最大化は集計し、未確認のWin+↑を案内しない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept({ ...sample, before: { state: 'normal', arranged: true } });
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 1, key: 0 } } });
  assert.equal(h.notices.length, 0);
});

test('保存が遅れても数値は残し、古くなった通知を後から出さない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const save = h.repository.saveCounts;
  h.repository.saveCounts = async (value) => { h.clock(5000); await save(value); };
  await h.coach.accept(sample);
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 1, key: 0 } } });
  assert.equal(h.notices.length, 0);
});

test('時計の後退では未来日の記録を削除せず停止し、日付復帰後に再開できる', async () => {
  const h = harness(); await h.repository.saveCounts({ '2026-10-12': { W03: { mouse: 8, key: 1 } } });
  await h.coach.initialize(); h.coach.begin(1);
  assert.equal(h.coach.snapshot().observing, false);
  assert.match(h.coach.snapshot().error ?? '', /日付/);
  assert.deepEqual(h.saved(), { '2026-10-12': { W03: { mouse: 8, key: 1 } } });
  h.date('2026-10-12'); await h.coach.initialize(); h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, true);
});

test('停止指示中に届いた保存待ちの候補は後から通知しない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  const task = h.coach.accept(sample); h.coach.stop(); await task;
  assert.equal(h.notices.length, 0);
  assert.deepEqual(h.saved(), {});
});

test('今日を含む30日を残し、全削除後も設定は保持する', async () => {
  const h = harness();
  await h.repository.saveCounts({ '2026-09-11': { W03: { mouse: 7, key: 0 } },
    '2026-09-12': { W03: { mouse: 2, key: 1 } }, '2026-10-11': { W03: { mouse: 1, key: 1 } } });
  await h.coach.initialize();
  assert.deepEqual(Object.keys(h.coach.snapshot().counts), ['2026-09-12', '2026-10-11']);
  await h.coach.setMuted('W03', true); await h.coach.deleteCounts();
  assert.deepEqual(h.saved(), {});
  assert.deepEqual(h.coach.snapshot().settings.muted, ['W03']);
});

test('同時に届いた観測も保存を直列化して通知は1件にする', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await Promise.all([1, 2, 3, 4, 5].map((sequence) => h.coach.accept({ ...sample, sequence })));
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 5, key: 0 } } });
  assert.equal(h.notices.length, 1);
});

test('保存失敗は通知と観測を止め、再試行で二重加算しない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1); h.fail(true);
  await assert.doesNotReject(() => h.coach.accept(sample));
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.notices.length, 0);
  assert.deepEqual(h.saved(), {});
  h.fail(false); await h.coach.retrySave(); h.coach.begin(2);
  await h.coach.accept(sample);
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 1, key: 0 } } });
  assert.equal(h.coach.snapshot().pendingSave, false);
});

test('通知停止・mute・頻度制限中も記録し、全停止と古い世代は数えない', async () => {
  const h = harness(); await h.coach.initialize(); h.coach.begin(1);
  await h.coach.accept(sample);
  h.clock(10_000); await h.coach.accept({ ...sample, sequence: 2 });
  assert.equal(h.notices.length, 1, '同じ操作は60秒間隔');
  h.coach.pauseNotifications(true);
  h.clock(60_000); await h.coach.accept({ ...sample, sequence: 3 });
  await h.coach.setMuted('W03', true); h.coach.pauseNotifications(false);
  await h.coach.accept({ ...sample, sequence: 4 });
  assert.equal(h.notices.length, 1);
  h.coach.stop(); await h.coach.accept({ ...sample, sequence: 5 });
  h.coach.begin(2); await h.coach.accept({ ...sample, sequence: 6 });
  await h.coach.setMuted('W03', false);
  await h.coach.accept({ ...sample, generation: 2, sequence: 1 });
  assert.deepEqual(h.saved(), { '2026-10-11': { W03: { mouse: 5, key: 0 } } });
  assert.equal(h.notices.length, 2);
});

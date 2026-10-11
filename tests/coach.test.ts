import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coach } from '../src/core/coach.ts';
import type { Counts, Settings, Candidate } from '../src/shared/coach.ts';

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
  const notices: unknown[] = [];
  const repository = {
    load: async () => ({ counts: structuredClone(counts), settings: structuredClone(settings) }),
    saveCounts: async (next: Counts) => { if (failSave) throw new Error('disk'); counts = structuredClone(next); },
    saveSettings: async (next: Settings) => { settings = structuredClone(next); }
  };
  const coach = new Coach({ repository, date: () => date, now: () => now,
    notify: async (notice) => { notices.push(notice); return true; }, changed: () => {} });
  return { coach, notices, saved: () => counts, repository,
    clock: (value: number) => { now = value; }, date: (value: string) => { date = value; },
    fail: (value: boolean) => { failSave = value; } };
}

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

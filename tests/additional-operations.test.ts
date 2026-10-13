import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/core/detector.ts';
import { Coach } from '../src/core/coach.ts';
import { JsonRepository } from '../src/main/repository.ts';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Candidate, Notice, OperationId } from '../src/shared/coach.ts';

const base: Candidate = {
  type: 'candidate', protocolVersion: 1, generation: 1, sequence: 1, app: 'chrome', date: '2026-10-12',
  operation: 'minimize', before: { state: 'normal', arranged: false }, after: { state: 'minimized' },
  origin: 'mouse', route: 'min-button', injected: false, conflicted: false, moving: false,
  elevated: false, targetMatched: true, inputAgeMs: 100, monitor: { x: 0, y: 0, width: 1920, height: 1080 }
};
export const addedCases: { id: OperationId; candidate: Candidate; key: string; shortcut: string }[] = [
  { id: 'W04', candidate: base, key: 'win-down', shortcut: 'Win + ↓' },
  { id: 'W05', candidate: { ...base, operation: 'restore', before: { state: 'maximized', arranged: false },
    after: { state: 'normal' }, afterArranged: false, route: 'max-button' }, key: 'win-down', shortcut: 'Win + ↓' },
  { id: 'W11', candidate: { ...base, operation: 'close', after: { state: 'closed' }, route: 'close-button' }, key: 'alt-f4', shortcut: 'Alt + F4' },
  { id: 'W02', candidate: { ...base, operation: 'monitor-move', after: { state: 'normal' }, route: 'caption-drag',
    fromMonitor: base.monitor, toMonitor: { x: 1920, y: 0, width: 1920, height: 1080 }, moveDirection: 'right' },
    key: 'win-shift-right', shortcut: 'Win + Shift + →' }
];

for (const entry of addedCases) {
  test(`${entry.id}は操作・由来・結果を照合して採用し、不十分な証拠を除外する`, () => {
    for (const app of ['chrome', 'obsidian', 'code', 'chatgpt']) {
      assert.equal(classify({ ...entry.candidate, app })?.operation, entry.id);
      assert.equal(classify({ ...entry.candidate, app, origin: 'key', route: entry.key })?.shortcut, entry.shortcut);
    }
    for (const invalid of [{ injected: true }, { conflicted: true }, { targetMatched: false }, { moving: true },
      { inputAgeMs: 1001 }, { inputAgeMs: -1 }, { origin: 'unknown' as const }, { route: 'client-click' },
      { elevated: true }, { app: 'codex' }, { after: { state: 'other' } }]) {
      assert.equal(classify({ ...entry.candidate, ...invalid }), null, JSON.stringify(invalid));
    }
  });
}

test('元状態に合わない最小化・復元と元画面への往復を除外する', () => {
  const minimize = addedCases[0].candidate, restore = addedCases[1].candidate, move = addedCases[3].candidate;
  for (const before of [{ state: 'maximized', arranged: false }, { state: 'normal', arranged: true }, { state: 'normal', arranged: null }]) {
    assert.equal(classify({ ...minimize, before })?.shortcut, null);
    assert.equal(classify({ ...minimize, before, origin: 'key', route: 'win-down' }), null);
  }
  assert.equal(classify({ ...restore, before: { state: 'normal', arranged: true } }), null);
  assert.equal(classify({ ...restore, afterArranged: true }), null);
  assert.equal(classify({ ...restore, afterArranged: undefined }), null);
  assert.equal(classify({ ...restore, route: 'caption-double-click' })?.operation, 'W05');
  assert.equal(classify({ ...move, toMonitor: move.fromMonitor }), null);
  assert.equal(classify({ ...move, fromMonitor: null }), null);
  assert.equal(classify({ ...move, moveDirection: null })?.shortcut, null);
  assert.equal(classify({ ...move, origin: 'key', route: 'win-shift-left' }), null);
});

test('追加4操作は通知・重複排除・操作別mute・停止・保存再読込まで接続する', async () => {
  const root = resolve('.tools/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'coach-added-'));
  const repository = new JsonRepository(directory);
  const notices: Notice[] = []; let now = 0;
  const coach = new Coach({ repository, date: () => base.date, now: () => now,
    notify: async (notice) => { notices.push(notice); return true; }, changed: () => {} });
  await coach.initialize(); coach.begin(1);
  let sequence = 0;
  for (const entry of addedCases) {
    now += 60_000;
    const mouse = { ...entry.candidate, sequence: ++sequence };
    await coach.accept(mouse); await coach.accept(mouse);
    assert.equal(coach.snapshot().error, null);
    assert.equal(notices.at(-1)?.operation, entry.id);
    assert.equal(notices.at(-1)?.shortcut, entry.shortcut);
    assert.notEqual(notices.at(-1)?.label, '最大化');
    await coach.accept({ ...mouse, sequence: ++sequence, origin: 'key', route: entry.key });
    await coach.setMuted(entry.id, true); now += 60_000;
    const count = notices.length;
    await coach.accept({ ...mouse, sequence: ++sequence });
    assert.equal(notices.length, count);
  }
  coach.stop(); await coach.accept({ ...base, sequence: ++sequence });
  const loaded = await repository.load();
  for (const entry of addedCases) assert.deepEqual(loaded.counts[base.date][entry.id], { mouse: 2, key: 1 });
  assert.deepEqual(loaded.settings.muted, addedCases.map((entry) => entry.id));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../../../src/core/serial-queue.ts';

test('直列キューは先の処理が完了するまで次を開始せず、各結果を返す', async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.run(async () => { events.push('first-start'); await blocked; events.push('first-end'); return 1; });
  const second = queue.run(async () => { events.push('second'); return 'two'; });
  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 'two']);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('同期例外と非同期失敗は呼出し元に返し、その後の処理を続ける', async () => {
  const queue = new SerialQueue();
  const syncError = new Error('synchronous');
  const asyncError = new Error('asynchronous');
  const first = queue.run(() => { throw syncError; });
  const second = queue.run(async () => { throw asyncError; });
  const third = queue.run(async () => 3);
  await assert.rejects(first, (error) => error === syncError);
  await assert.rejects(second, (error) => error === asyncError);
  assert.equal(await third, 3);
});

test('別々のキューは互いの処理を待たない', async () => {
  const first = new SerialQueue(), second = new SerialQueue();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const pending = first.run(() => blocked);
  try { assert.equal(await second.run(async () => 'independent'), 'independent'); }
  finally { release(); await pending; }
});

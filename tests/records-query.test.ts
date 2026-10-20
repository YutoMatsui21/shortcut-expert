import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { candidateFixture } from './support/fixtures.ts';

test('record summary queries real Worker for seven days and serializes counts/settings/revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'coach-records-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, {recursive: true, force: true}); });
  await writeFile(join(root, 'counts.json'), JSON.stringify({schemaVersion: 1, days: {
    '2026-10-12': { W03: {mouse: 99, key: 99} },
    '2026-10-13': { W03: {mouse: 3, key: 1} },
    '2026-10-19': { W01: {mouse: 0, key: 6} }
  }}));
  let today = '2026-10-19';
  const coach = new DurableCoach({ repository, session: repository.session, date: () => today, now: () => 0,
    capabilities: () => [], changed: () => {}, notify: async () => false });
  await coach.initialize(); coach.begin(1);
  const sample = candidateFixture({date: today});
  const writing = coach.accept(sample);
  const setting = coach.setLearningState('W03', 'mastered');
  const reading = coach.getRecordSummary(today);
  await Promise.all([writing, setting]);
  const result = await reading;
  assert.equal(result.summary.mouse, 4); assert.equal(result.summary.key, 7);
  assert.equal(result.revision, coach.snapshot().revision);
  assert.equal(result.rows.find(row => row.id === 'W03')?.state, 'mastered');
  assert.equal('counts' in result, false); assert.equal('coverage' in result, false);
  today = '2026-10-26';
  assert.equal((await coach.getRecordSummary(today)).summary.total, null, 'stopped/idle display follows calendar without creating zeros');
  today = '2026-10-19';
  coach.stop(); await coach.deleteCounts();
  assert.equal((await coach.getRecordSummary(today)).summary.total, null);
  assert.equal((await coach.getRecordSummary(today)).rows.find(row => row.id === 'W03')?.state, 'mastered');
});

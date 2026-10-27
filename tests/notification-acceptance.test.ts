import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { localDate } from '../src/core/dates.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { runNotificationAcceptance } from '../src/main/notification-acceptance.ts';
import type { ShortcutNotice } from '../src/shared/coach.ts';

test('V01 artificial candidates commit twice for maximize and once for restore before individual delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v01-'));
  const repository = new SqliteRepository(directory, resolve('src/main/storage-worker.ts'));
  const notices: ShortcutNotice[] = [];
  const deliveries: Promise<boolean>[] = [];
  const coach = new DurableCoach({ repository, session: repository.session, date: localDate, now: () => 0,
    capabilities: () => [], changed: () => {}, notify: notice => {
      const delivery = repository.query(localDate(), localDate()).then(saved => {
        assert.ok(saved.counts[localDate()][notice.operation]?.mouse);
        notices.push(notice); return true;
      });
      deliveries.push(delivery); return delivery;
    } });
  try {
    await coach.initialize(); coach.begin(1);
    let fixtureActive = false;
    await runNotificationAcceptance(coach, {
      stop: async () => { fixtureActive = false; },
      start: async () => { fixtureActive = true; return 2; },
      inject: async candidate => { assert.ok(fixtureActive); assert.equal(candidate.generation, 2); await coach.accept(candidate); }
    }, async () => {});
    await coach.idle();
    await Promise.all(deliveries);
    assert.deepEqual(notices.map(value => value.operation), ['W03', 'W03', 'W04']);
    const saved = await repository.query(localDate(), localDate());
    assert.deepEqual(saved.counts[localDate()].W03, { mouse: 2, key: 0 });
    assert.deepEqual(saved.counts[localDate()].W04, { mouse: 1, key: 0 });
  } finally { coach.stop(); await coach.idle(); await repository.close(); await rm(directory, { recursive: true, force: true }); }
});

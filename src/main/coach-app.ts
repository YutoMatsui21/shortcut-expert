import { app, type BrowserWindow, dialog, Menu, nativeImage, screen, Tray, powerMonitor } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { Coach } from '../core/coach';
import { DurableCoach } from '../core/durable-coach';
import { selectRepositoryWithRetry, SqliteRepository } from './sqlite-repository';
import { JsonRepository } from './repository';
import { SerialQueue } from '../core/serial-queue';
import { localDate } from '../core/dates';
import type { Snapshot } from '../shared/coach';
import { ObserverClient } from './observer';
import { NotificationWindow } from './notification';
import { StandardNotifications, type NotificationResult } from './standard-notification';
import { runCoachSmoke } from './smoke';
import { runStorageSmoke } from './storage-smoke';
import { runMigrationSmoke } from './migration-smoke';
import { seedComparisonCoverage, runRecordsComparisonSmoke } from './records-comparison-smoke';
import { CoachWindow } from './coach-window';
import { registerCoachIpc } from './coach-ipc';
import { coachTrayMenu } from './coach-tray';
import { runSettingsSmoke } from './settings-smoke';
import { runActivationSmoke } from './activation-smoke';
import { learningReadModel } from '../core/learning';
import { recordsReadModel } from '../core/records';
import { runNotificationAcceptance } from './notification-acceptance';
import { runUiAcceptance } from './ui-acceptance';

const coachWindow = new CoachWindow();
let quitting = false;
export function showCoach(): void {
  coachWindow.show();
}

export async function runCoach(load: (window: BrowserWindow, mode: string) => Promise<void>, fixture: boolean): Promise<void> {
  const osAcceptance = fixture && process.argv.includes('--os-notification-acceptance');
  const uiAcceptance = fixture && process.argv.includes('--ui-acceptance');
  let tray: Tray | null = null;
  let ticker: NodeJS.Timeout | undefined;
  let errorStop = false;
  let fixtureQuitResponse: number | null = null;
  let fixtureTick: (() => void) | null = null;
  let exiting: Promise<void> | null = null;
  let exitRequested = false;
  let deleteResume: boolean | null = null;
  const control = new SerialQueue();
  let date = localDate();
  const previews: { notification: BrowserWindow | null } = { notification: null };
  const observer = new ObserverClient((candidate) => { void coach.accept(candidate); }, () => {
    notice.dismiss(); coach.fault('Windowsの観測が停止しました。再開してください。');
  }, fixture);
  const notice = new NotificationWindow(observer, async (window, mode) => { previews.notification = window; await load(window, mode); });
  const fixtureNoticeResults: NotificationResult[] = [];
  const fixtureNoticeEvents: EventEmitter[] = [];
  const standardNotices = new StandardNotifications(() => { if (osAcceptance) console.log('V01_ACTIVATION instance'); showCoach(); }, result => {
    if (osAcceptance) console.log('V01_DELIVERY ' + JSON.stringify(result));
    if (fixture && !osAcceptance) fixtureNoticeResults.push(result);
    if (result.status === 'failed' || result.status === 'unknown') console.error('COACH_NOTIFICATION_' + result.status.toUpperCase());
  }, fixture && !osAcceptance ? () => {
    const events = new EventEmitter();
    fixtureNoticeEvents.push(events);
    return Object.assign(events, { show: () => { events.emit('show'); } });
  } : undefined);
  app.once('will-quit', () => standardNotices.dispose());
  const publish = (snapshot: Snapshot) => {
    coachWindow.publish(snapshot);
    if (tray) {
      tray.setToolTip(snapshot.error ? '確認が必要です' : snapshot.observing ? snapshot.notificationsPaused ? '記録中・通知停止' : '記録中' : '全停止');
      tray.setContextMenu(Menu.buildFromTemplate(coachTrayMenu(snapshot, command, showCoach, quit)));
    }
    if (snapshot.error && !errorStop) { errorStop = true; notice.dismiss(); void observer.stop().catch(() => {}); }
  };
  // Keep the established JSON smoke as legacy regression. New storage has its own empty-userData smoke.
  const migrationFixture = process.argv.includes('--migration-smoke');
  const storageFixture = osAcceptance || uiAcceptance || process.argv.includes('--storage-smoke') || migrationFixture;
  if (fixture && !storageFixture) await writeFile(join(app.getPath('userData'), 'counts.json'), JSON.stringify({ schemaVersion: 1, days: {} }), { flag: 'wx' });
  const workerPath = join(__dirname, 'storage-worker.cjs').replace('app.asar', 'app.asar.unpacked');
  const repository = fixture && !storageFixture ? new JsonRepository(app.getPath('userData')) : await selectRepositoryWithRetry(app.getPath('userData'), workerPath, async () => {
    const answer = await dialog.showMessageBox({ type: 'error', message: '保存先を確認できません。',
      detail: '元のデータは変更していません。保存先へのアクセスを確認して再試行してください。',
      buttons: ['再試行', '終了'], defaultId: 0, cancelId: 1 });
    return answer.response === 0;
  });
  const common = { date: localDate, now: () => performance.now(), changed: publish };
  const activationFixture = fixture && process.argv.includes('--activation-smoke');
  const activationFailureFixture = activationFixture && process.argv.includes('--activation-failure-smoke');
  if (activationFailureFixture) repository.load = async () => { throw new Error('fixture initialization failure'); };
  const comparisonFixture = fixture && process.argv.includes('--comparison-smoke');
  if (comparisonFixture) {
    if (!(repository instanceof SqliteRepository)) throw new Error('Comparison fixture requires isolated SQLite');
    await seedComparisonCoverage(repository);
  }
  const coach = repository instanceof SqliteRepository
    ? new DurableCoach({ ...common, repository, session: repository.session,
      notify: value => standardNotices.show(value),
      capabilities: () => fixture ? [{ operation: 'W03', revision: 'fixture-v1' }] : [] })
    : new Coach({ ...common, repository, notify: value => notice.show(value) });
  const startObservation = async () => {
    if (exitRequested) return;
    const snapshot = coach.snapshot();
    if (snapshot.observing || snapshot.pendingSave) return;
    if (snapshot.error) await coach.initialize();
    if (coach.snapshot().error) return;
    try { const generation = await observer.start(); errorStop = false; coach.begin(generation); publish(coach.snapshot()); }
    catch (error) {
      if (fixture) console.error('COACH_FIXTURE_START_FAILED ' + (error instanceof Error ? error.message : 'unknown'));
      coach.fault(error instanceof Error && error.message === 'arranged-api-unavailable'
      ? '最大化判定に必要なWindows機能を取得できません。'
      : 'Windowsの観測を開始できません。再開してください。'); }
  };
  const stopObservation = async () => {
    coach.stop(); notice.dismiss();
    try { await observer.stop(); }
    catch { coach.fault('観測の解除を確認できませんでした。再開時に初期化します。'); }
  };
  const command = (value: string) => control.run(async () => {
    if (exitRequested) return coachWindow.withWindowState(coach.snapshot());
    switch (value) {
      case 'pause-notifications': coach.pauseNotifications(true); notice.dismiss(); break;
      case 'resume-notifications': coach.pauseNotifications(false); break;
      case 'stop': await stopObservation(); break;
      case 'start': await startObservation(); break;
      case 'retry-save':
        await coach.retrySave();
        if (deleteResume !== null && !coach.snapshot().error && !coach.snapshot().pendingSave) {
          const resume = deleteResume; deleteResume = null;
          if (resume) await startObservation();
        }
        break;
      case 'quit': break;
      default: throw new Error('Unknown command.');
    }
    return coachWindow.withWindowState(coach.snapshot());
  });
  const performQuit = async () => {
    exitRequested = true;
    // Drain earlier UI commands before stopping; prevent a queued start from reattaching hooks.
    await control.run(async () => {});
    await stopObservation();
    await coachWindow.flush(true); await coach.idle();
    const window = coachWindow.current;
    if (coach.snapshot().pendingSave && window) {
      const answer = fixture && fixtureQuitResponse !== null ? { response: fixtureQuitResponse } : await dialog.showMessageBox(window, { type: 'warning', message: '未保存の記録または設定があります。',
        detail: '終了すると未保存分は失われます。', buttons: ['戻る', '未保存のまま終了'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) { exitRequested = false; coachWindow.resumeBounds(); showCoach(); return; }
    }
    await coach.idle(); await observer.shutdown(); if (repository instanceof SqliteRepository) await repository.close();
    clearInterval(ticker);
    quitting = true; tray?.destroy(); app.quit();
  };
  const quit = (): Promise<void> => {
    if (quitting) return Promise.resolve();
    if (!exiting) exiting = performQuit().catch(() => {
      exitRequested = false; coachWindow.resumeBounds();
      coach.fault('終了処理を確認できませんでした。保存状態を確認して終了を再試行してください。'); showCoach();
    }).finally(() => { exiting = null; });
    return exiting;
  };
  const deleteCounts = () => control.run(async () => {
    if (exitRequested) return coachWindow.withWindowState(coach.snapshot());
    deleteResume ??= coach.snapshot().observing;
    await stopObservation(); await coach.deleteCounts();
    if (!coach.snapshot().error && !coach.snapshot().pendingSave) {
      const resume = deleteResume; deleteResume = null;
      if (resume) await startObservation();
    }
    return coachWindow.withWindowState(coach.snapshot());
  });
  registerCoachIpc(() => coachWindow.current, (id) => notice.sender(id), {
    getRecordSummary: (query) => control.run(async () => {
      if (exitRequested) throw new Error('終了処理中です。');
      try {
        const today = localDate();
        if (coach instanceof DurableCoach) return await coach.getRecordSummary(today, query);
        const snapshot = coach.snapshot();
        return recordsReadModel({ counts: snapshot.counts, coverage: {}, revision: 0 }, snapshot.settings, today, query);
      } catch {
        coach.storageFault('記録を読み込めません。元のデータは保持しています。');
        throw new Error('記録を読み込めません。');
      }
    }),
    getLearning: () => control.run(async () => {
      if (exitRequested) throw new Error('終了処理中です。');
      const today = localDate();
      try {
        const snapshot = coach.snapshot();
        if (coach instanceof DurableCoach) return await coach.getLearning(today);
        const records = { counts: snapshot.counts, coverage: {}, revision: 0 };
        return learningReadModel(records, snapshot.settings, today);
      } catch { coach.storageFault('一覧の記録を読み込めません。元のデータは保持しています。'); throw new Error('一覧を読み込めません。'); }
    }),
    windowCommand: async (value) => { if (!exitRequested) coachWindow.command(value); },
    getRecords: async (from, to) => {
      if (exitRequested) throw new Error('終了処理中です。');
      try {
        if (repository instanceof SqliteRepository) return await repository.query(from, to);
        const loaded = await repository.load();
        return { counts: Object.fromEntries(Object.entries(loaded.counts).filter(([day]) => day >= from && day <= to)), coverage: {}, revision: 0 };
      } catch { coach.storageFault('保存データを読み込めません。元のデータは保持しています。'); throw new Error('記録を読み込めません。'); }
    },
    getSnapshot: async () => { if (!exitRequested) await coach.tick(); return coachWindow.withWindowState(coach.snapshot()); },
    getNotice: async () => notice.current(),
    command: value => value === 'quit' ? quit().then(() => coachWindow.withWindowState(coach.snapshot())) : command(value),
    setMuted: (operation, muted) => control.run(async () => {
      if (exitRequested) return coachWindow.withWindowState(coach.snapshot());
      await coach.setMuted(operation, muted); if (muted) notice.dismiss(); return coachWindow.withWindowState(coach.snapshot());
    }),
    setLearningState: (operation, state) => control.run(async () => {
      if (exitRequested) return coachWindow.withWindowState(coach.snapshot());
      await coach.setLearningState(operation, state);
      if (state !== 'learning') notice.dismiss();
      return coachWindow.withWindowState(coach.snapshot());
    }),
    deleteCounts
  });
  await coach.initialize();
  app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); void quit(); } });
  const window = await coachWindow.create(load, () => quitting, {
    saved: coach.snapshot().settings.normalBounds,
    workAreas: () => [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter(display => display.id !== screen.getPrimaryDisplay().id)].map(display => display.workArea),
    save: bounds => coach.setNormalBounds(bounds)
  });
  if (!fixture || osAcceptance || uiAcceptance) {
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 36) {
      const at = (y * 16 + x) * 4; pixels[at] = 72; pixels[at + 1] = 122; pixels[at + 2] = 33; pixels[at + 3] = 255;
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
    tray.on('double-click', showCoach);
    const snapshot = coach.snapshot();
    if (!snapshot.settings.opened || snapshot.error) { showCoach(); if (!snapshot.error) await coach.opened(); }
  }
  await startObservation(); publish(coach.snapshot());
  ticker = setInterval(() => {
    if (exitRequested) return;
    if (repository instanceof SqliteRepository) void coach.tick();
    else if (localDate() !== date) { date = localDate(); void coach.tick().then(() => publish(coach.snapshot())); }
    fixtureTick?.();
  }, 1000);
  app.once('will-quit', () => clearInterval(ticker));
  powerMonitor.on('suspend', () => { if (coach.snapshot().observing) { notice.dismiss(); coach.fault('スリープで観測が中断しました。再開してください。'); } });
  const displaysChanged = () => { notice.dismiss(); coachWindow.correctBounds(); };
  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);
  if (osAcceptance) {
    clearInterval(ticker);
    showCoach();
    if (!(coach instanceof DurableCoach)) throw new Error('V01 requires isolated SQLite');
    await runNotificationAcceptance(coach, observer);
    return; // Keep real notification instances and tray alive for manual history clicks.
  }
  if (uiAcceptance) {
    showCoach();
    try { await runUiAcceptance(window); }
    catch (error) { console.error('V03_MATRIX_FAILED', error); await quit(); return; }
    console.log('V03_READY fixture-only; real input observation disabled; exit via tray');
    if (process.argv.includes('--ui-acceptance-exit')) await quit();
    return;
  }
  if (fixture) {
    if (storageFixture) clearInterval(ticker);
    let deadline: NodeJS.Timeout | undefined;
    let report: Awaited<ReturnType<typeof runCoachSmoke>> | Awaited<ReturnType<typeof runStorageSmoke>> | Awaited<ReturnType<typeof runMigrationSmoke>> | Awaited<ReturnType<typeof runRecordsComparisonSmoke>> | Awaited<ReturnType<typeof runSettingsSmoke>> | Awaited<ReturnType<typeof runActivationSmoke>> | undefined;
    try {
      report = await Promise.race([
        activationFixture ? runActivationSmoke({ window, snapshot: () => coach.snapshot(), command, activate: showCoach,
          failed: activationFailureFixture, notifications: standardNotices, notificationEvents: fixtureNoticeEvents }) : process.argv.includes('--settings-smoke') ? runSettingsSmoke(window, () => coach.snapshot(), command, repository, coach) : comparisonFixture ? runRecordsComparisonSmoke(window) : migrationFixture ? runMigrationSmoke({ coach, window, repository }) : storageFixture ? runStorageSmoke({ coach, observer, window, repository,
          verifyNotifications: async sample => {
            await stopObservation();
            const generation = await observer.start(); coach.begin(generation); coach.pauseNotifications(false);
            const before = coach.snapshot().counts[localDate()]?.W03?.mouse ?? 0;
            const offset = fixtureNoticeResults.length;
            for (let sequence = 1; sequence <= 3; sequence++) {
              await observer.inject({ ...sample, generation, sequence, origin: 'mouse', route: 'max-button', monitor: null });
            }
            await coach.idle();
            const results = fixtureNoticeResults.slice(offset);
            if (coach.snapshot().counts[localDate()]?.W03?.mouse !== before + 3 ||
              results.filter(value => value.status === 'requested').length !== 3 ||
              results.filter(value => value.status === 'api-returned').length !== 3 ||
              results.filter(value => value.status === 'show-event').length !== 3 ||
              new Set(results.map(value => value.id)).size !== 3 || previews.notification !== null) throw new Error('standard-notification-fixture');
          },
          verifyPendingExit: async () => {
            window.show();
            const save = repository.saveSettings.bind(repository);
            repository.saveSettings = async () => { throw new Error('fixture quit settings failure'); };
            fixtureQuitResponse = 0;
            try {
              await coach.setNormalBounds(window.getNormalBounds());
              await Promise.all([quit(), command('start'), quit(), command('retry-save')]);
              if (quitting || !coach.snapshot().pendingSave || coach.snapshot().observing || exitRequested) {
                throw new Error('durable-quit-cancel-pending ' + JSON.stringify({ quitting, pending: coach.snapshot().pendingSave, observing: coach.snapshot().observing, exitRequested }));
              }
            } finally { repository.saveSettings = save; fixtureQuitResponse = null; }
            await command('retry-save');
            if (coach.snapshot().pendingSave || coach.snapshot().observing) throw new Error('durable-quit-retry-stopped');
          }
        }) : runCoachSmoke({ coach, observer, notice, window,
          getNotificationWindow: () => previews.notification, directory: app.getPath('userData'),
          verifyWindowExit: async () => {
            const save = repository.saveSettings.bind(repository);
            repository.saveSettings = async () => { throw new Error('fixture settings failure'); };
            const before = window.getNormalBounds();
            window.setBounds({ ...before, width: before.width === 1000 ? 1001 : 1000 });
            // Make the OS response deterministic, retaining production flush/stop/confirmation.
            fixtureQuitResponse = 0;
            await Promise.all([quit(), quit()]);
            if (quitting || !coach.snapshot().pendingSave || coach.snapshot().observing || !window.isVisible()) throw new Error('quit-cancel-pending');
            repository.saveSettings = save;
            fixtureQuitResponse = null;
            await coach.retrySave();
            if (coach.snapshot().pendingSave) throw new Error('quit-retry-save');
            const shutdown = observer.shutdown.bind(observer);
            observer.shutdown = async () => { throw new Error('fixture unconfirmed helper exit'); };
            await quit();
            observer.shutdown = shutdown;
            if (quitting || !window.isVisible()) throw new Error('quit-failure-recovery');
            await command('start');
            if (!coach.snapshot().observing) throw new Error('quit-failure-restart');
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => { fixtureTick = null; reject(new Error('quit-failure-ticker')); }, 3000);
              fixtureTick = () => { fixtureTick = null; clearTimeout(timeout); resolve(); };
            });
          } }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('smoke-timeout')), 25_000);
        })
      ]);
      await stopObservation();
    } catch (error) {
      report = undefined;
      console.error('COACH_SMOKE_STAGE_FAILED ' + (error instanceof Error ? error.stack ?? error.message : 'unknown'));
    }
    finally {
      clearTimeout(deadline); clearInterval(ticker);
      if (report && !storageFixture) {
        app.once('will-quit', () => console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true, safeExit: true })));
        await Promise.all([quit(), quit()]);
        if (!quitting) { console.error('COACH_SMOKE_FAILED safe-exit'); app.exit(1); }
        return;
      }
      coach.stop(); notice.dismiss(); await observer.shutdown(); if (repository instanceof SqliteRepository) await repository.close(); quitting = true;
      if (report) console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true }));
      else console.error('COACH_SMOKE_FAILED');
      app.exit(report ? 0 : 1);
    }
  }
}

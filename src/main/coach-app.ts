import { app, type BrowserWindow, dialog, Menu, nativeImage, screen, Tray, powerMonitor } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Coach } from '../core/coach';
import { DurableCoach } from '../core/durable-coach';
import { selectRepository, SqliteRepository } from './sqlite-repository';
import { SerialQueue } from '../core/serial-queue';
import { localDate } from '../core/dates';
import type { Snapshot } from '../shared/coach';
import { ObserverClient } from './observer';
import { NotificationWindow } from './notification';
import { runCoachSmoke } from './smoke';
import { runStorageSmoke } from './storage-smoke';
import { CoachWindow } from './coach-window';
import { registerCoachIpc } from './coach-ipc';

const coachWindow = new CoachWindow();
let quitting = false;
export function showCoach(): void { coachWindow.show(); }

export async function runCoach(load: (window: BrowserWindow, mode: string) => Promise<void>, fixture: boolean): Promise<void> {
  let tray: Tray | null = null;
  let ticker: NodeJS.Timeout | undefined;
  let errorStop = false;
  let fixtureDeleteResponse: number | null = null;
  const control = new SerialQueue();
  let date = localDate();
  const previews: { notification: BrowserWindow | null } = { notification: null };
  const observer = new ObserverClient((candidate) => { void coach.accept(candidate); }, () => {
    notice.dismiss(); coach.fault('Windowsの観測が停止しました。再開してください。');
  }, fixture);
  const notice = new NotificationWindow(observer, async (window, mode) => { previews.notification = window; await load(window, mode); });
  const publish = (snapshot: Snapshot) => {
    coachWindow.publish(snapshot);
    if (tray) {
      tray.setToolTip(snapshot.error ? '確認が必要です' : snapshot.observing ? snapshot.notificationsPaused ? '記録中・通知停止' : '記録中' : '全停止');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '記録を見る', click: showCoach },
        { label: snapshot.notificationsPaused ? '通知を再開' : '通知を停止', enabled: snapshot.observing, click: () => { void command(snapshot.notificationsPaused ? 'resume-notifications' : 'pause-notifications'); } },
        { label: snapshot.observing ? '全停止' : '計測を再開', click: () => { void command(snapshot.observing ? 'stop' : 'start'); } },
        { type: 'separator' }, { label: '終了', click: () => { void quit(); } }
      ]));
    }
    if (snapshot.error && !errorStop) { errorStop = true; notice.dismiss(); void observer.stop().catch(() => {}); }
  };
  // Keep the established JSON smoke as legacy regression. New storage has its own empty-userData smoke.
  const storageFixture = process.argv.includes('--storage-smoke');
  if (fixture && !storageFixture) await writeFile(join(app.getPath('userData'), 'counts.json'), JSON.stringify({ schemaVersion: 1, days: {} }), { flag: 'wx' });
  const workerPath = join(__dirname, 'storage-worker.cjs').replace('app.asar', 'app.asar.unpacked');
  const repository = await selectRepository(app.getPath('userData'), workerPath);
  const common = { date: localDate, now: () => performance.now(), notify: (value: import('../shared/coach').Notice) => notice.show(value), changed: publish };
  const coach = repository instanceof SqliteRepository
    ? new DurableCoach({ ...common, repository, session: repository.session,
      capabilities: () => fixture ? [{ operation: 'W03', revision: 'fixture-v1' }] : [] })
    : new Coach({ ...common, repository });
  const startObservation = async () => {
    const snapshot = coach.snapshot();
    if (snapshot.observing || snapshot.pendingSave) return;
    if (snapshot.error) await coach.initialize();
    if (coach.snapshot().error) return;
    try { const generation = await observer.start(); errorStop = false; coach.begin(generation); publish(coach.snapshot()); }
    catch (error) { coach.fault(error instanceof Error && error.message === 'arranged-api-unavailable'
      ? '最大化判定に必要なWindows機能を取得できません。'
      : 'Windowsの観測を開始できません。再開してください。'); }
  };
  const stopObservation = async () => {
    coach.stop(); notice.dismiss();
    try { await observer.stop(); }
    catch { coach.fault('観測の解除を確認できませんでした。再開時に初期化します。'); }
  };
  const command = (value: string) => control.run(async () => {
    switch (value) {
      case 'pause-notifications': coach.pauseNotifications(true); notice.dismiss(); break;
      case 'resume-notifications': coach.pauseNotifications(false); break;
      case 'stop': await stopObservation(); break;
      case 'start': await startObservation(); break;
      case 'retry-save': await coach.retrySave(); break;
      case 'quit': await quit(); break;
      default: throw new Error('Unknown command.');
    }
    return coach.snapshot();
  });
  const quit = async () => {
    if (quitting) return;
    coach.stop(); notice.dismiss(); await coach.idle();
    const window = coachWindow.current;
    if (coach.snapshot().pendingSave && window) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', message: '未保存の記録または設定があります。',
        detail: '終了すると未保存分は失われます。', buttons: ['戻る', '未保存のまま終了'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) { showCoach(); return; }
    }
    quitting = true; clearInterval(ticker); await coach.idle(); await observer.shutdown(); if (repository instanceof SqliteRepository) await repository.close(); tray?.destroy(); app.quit();
  };
  const deleteCounts = () => control.run(async () => {
    const window = coachWindow.current;
    if (!window) return coach.snapshot();
    // Replace only the OS confirmation response in the isolated smoke, not deletion logic.
    const result = fixture && fixtureDeleteResponse !== null ? { response: fixtureDeleteResponse } : await dialog.showMessageBox(window, { type: 'question', message: '保存した全日分の記録を削除しますか？',
      detail: '操作別の通知設定は残ります。', buttons: ['キャンセル', '記録を削除'], defaultId: 0, cancelId: 0 });
    fixtureDeleteResponse = null;
    if (result.response !== 1) return coach.snapshot();
    const resume = coach.snapshot().observing; await stopObservation(); await coach.deleteCounts();
    if (!coach.snapshot().error && resume) await startObservation();
    return coach.snapshot();
  });
  registerCoachIpc(() => coachWindow.current, (id) => notice.sender(id), {
    getRecords: async (from, to) => {
      try {
        if (repository instanceof SqliteRepository) return await repository.query(from, to);
        const loaded = await repository.load();
        return { counts: Object.fromEntries(Object.entries(loaded.counts).filter(([day]) => day >= from && day <= to)), coverage: {}, revision: 0 };
      } catch { coach.fault('保存データを読み込めません。元のデータは保持しています。'); throw new Error('記録を読み込めません。'); }
    },
    getSnapshot: async () => { await coach.tick(); return coach.snapshot(); },
    getNotice: async () => notice.current(),
    command,
    setMuted: (operation, muted) => control.run(async () => {
      await coach.setMuted(operation, muted); if (muted) notice.dismiss(); return coach.snapshot();
    }),
    deleteCounts
  });
  await coach.initialize();
  app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); void quit(); } });
  const window = await coachWindow.create(load, () => quitting);
  if (!fixture) {
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 36) {
      const at = (y * 16 + x) * 4; pixels[at] = 72; pixels[at + 1] = 122; pixels[at + 2] = 33; pixels[at + 3] = 255;
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
    tray.on('double-click', showCoach);
    const snapshot = coach.snapshot();
    if (!snapshot.settings.opened || snapshot.error) { showCoach(); await coach.opened(); }
  }
  await startObservation(); publish(coach.snapshot());
  ticker = setInterval(() => {
    if (repository instanceof SqliteRepository || localDate() !== date) { date = localDate(); void coach.tick().then(() => publish(coach.snapshot())); }
  }, 1000);
  app.once('will-quit', () => clearInterval(ticker));
  powerMonitor.on('suspend', () => { notice.dismiss(); coach.fault('スリープで観測が中断しました。再開してください。'); });
  screen.on('display-removed', () => notice.dismiss());
  screen.on('display-metrics-changed', () => notice.dismiss());
  if (fixture) {
    if (storageFixture) clearInterval(ticker);
    let deadline: NodeJS.Timeout | undefined;
    let report: Awaited<ReturnType<typeof runCoachSmoke>> | Awaited<ReturnType<typeof runStorageSmoke>> | undefined;
    try {
      report = await Promise.race([
        storageFixture ? runStorageSmoke({ coach, observer, window, repository }) : runCoachSmoke({ coach, observer, notice, window,
          getNotificationWindow: () => previews.notification, directory: app.getPath('userData'),
          chooseDelete: (response) => { fixtureDeleteResponse = response; } }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('smoke-timeout')), 25_000);
        })
      ]);
      await stopObservation();
    } catch (error) {
      report = undefined;
      console.error('COACH_SMOKE_STAGE_FAILED ' + (error instanceof Error ? error.message : 'unknown'));
    }
    finally {
      clearTimeout(deadline); clearInterval(ticker);
      coach.stop(); notice.dismiss(); await observer.shutdown(); if (repository instanceof SqliteRepository) await repository.close(); quitting = true;
      if (report) console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true }));
      else console.error('COACH_SMOKE_FAILED');
      app.exit(report ? 0 : 1);
    }
  }
}

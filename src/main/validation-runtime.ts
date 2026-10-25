import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { Coach } from '../core/coach';
import { DurableCoach, type Capability } from '../core/durable-coach';
import { localDate } from '../core/dates';
import type { SerialQueue } from '../core/serial-queue';
import { SqliteRepository } from './sqlite-repository';
import type { JsonRepository } from './repository';
import type { ObserverClient } from './observer';
import type { NotificationWindow } from './notification';
import type { StandardNotifications, NotificationResult } from './standard-notification';
import type { StartupMode } from './startup-mode.ts';
import { runCoachSmoke } from './smoke';
import { runStorageSmoke } from './storage-smoke';
import { runMigrationSmoke } from './migration-smoke';
import { seedComparisonCoverage, runRecordsComparisonSmoke } from './records-comparison-smoke';
import { runSettingsSmoke } from './settings-smoke';
import { runActivationSmoke } from './activation-smoke';
import { runNotificationAcceptance } from './notification-acceptance';
import { runUiAcceptance } from './ui-acceptance';
import { runNaturalInputAcceptance } from './natural-input-acceptance';
import { createLegacyRuntime } from './legacy-fixture-runtime.ts';

type ValidationContext = {
  coach: Coach | DurableCoach; observer: ObserverClient; notice: NotificationWindow;
  window: BrowserWindow; repository: JsonRepository | SqliteRepository; workerPath: string;
  standardNotices: StandardNotifications; previews: { notification: BrowserWindow | null };
  command(value: string): Promise<import('../shared/coach').Snapshot>;
  startObservation(): Promise<void>; stopObservation(): Promise<void>; quit(): Promise<void>;
  showCoach(): void; control: SerialQueue; readonly ticker: NodeJS.Timeout | undefined;
  quitting: boolean; readonly exitRequested: boolean;
};

// Loaded only for an explicit validation entry. It uses production commands and shutdown.
export class ValidationRuntime {
  createLegacyRuntime(...args: Parameters<typeof createLegacyRuntime>) {
    return this.mode.legacyRepository ? createLegacyRuntime(...args) : undefined;
  }
  naturalControl: ReturnType<typeof runNaturalInputAcceptance> | undefined;
  private naturalArming = false;
  quitResponse: number | null = null;
  tick: (() => void) | null = null;
  private noticeResults: NotificationResult[] = [];
  private noticeEvents: EventEmitter[] = [];
  private mode: StartupMode;
  constructor(mode: StartupMode) { this.mode = mode; }
  get canStartObservation() { return this.mode.naturalOperation === null || this.naturalArming; }
  capabilities(): Capability[] { return this.mode.fixture ? [{ operation: 'W03', revision: 'fixture-v1' }] : []; }
  activated() { if (this.mode.osAcceptance) console.log('V01_ACTIVATION instance'); }
  notificationResult(result: NotificationResult) {
    if (this.mode.osAcceptance) console.log('V01_DELIVERY ' + JSON.stringify(result));
    if (this.mode.fixture && !this.mode.osAcceptance) this.noticeResults.push(result);
  }
  get createNotification() {
    return this.mode.fixture && !this.mode.osAcceptance ? () => {
      const events = new EventEmitter(); this.noticeEvents.push(events);
      return Object.assign(events, { show: () => { events.emit('show'); } });
    } : undefined;
  }
  startFailed(error: unknown) {
    if (this.mode.fixture) console.error('COACH_FIXTURE_START_FAILED ' + (error instanceof Error ? error.message : 'unknown'));
  }
  async prepareData() {
    if (this.mode.legacyRepository) await writeFile(join(app.getPath('userData'), 'counts.json'), JSON.stringify({ schemaVersion: 1, days: {} }), { flag: 'wx' });
  }
  async prepareRepository(repository: JsonRepository | SqliteRepository) {
    if (this.mode.activationFailure) repository.load = async () => { throw new Error('fixture initialization failure'); };
    if (this.mode.comparison) {
      if (!(repository instanceof SqliteRepository)) throw new Error('Comparison fixture requires isolated SQLite');
      await seedComparisonCoverage(repository);
    }
  }
  async run(context: ValidationContext): Promise<void> {
    const mode = this.mode;
    const { fixture, osAcceptance, uiAcceptance, storage, activation, activationFailure, comparison, migration } = mode;
    const naturalOperation = mode.naturalOperation ?? 'W08';
    const naturalAcceptance = !fixture && mode.naturalOperation !== null;
    const { coach, observer, notice, window, repository, standardNotices, previews,
      command, startObservation, stopObservation, quit, showCoach, control, ticker } = context;
    if (naturalAcceptance) {
      this.naturalControl = runNaturalInputAcceptance(app.getPath('userData'), {
        snapshot: () => coach.snapshot(), start: paused => control.run(async () => {
          this.naturalArming = true; try { await startObservation(); coach.pauseNotifications(paused); } finally { this.naturalArming = false; }
        }), stop: () => control.run(stopObservation), idle: () => coach.idle(),
        configure: state => coach.setLearningState(naturalOperation, state)
      }, quit, naturalOperation);
      app.once('will-quit', () => this.naturalControl?.dispose());
      return;
    }
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
      if (mode.uiExit) await quit();
      return;
    }
    if (fixture) {
      if (storage) clearInterval(ticker);
      let deadline: NodeJS.Timeout | undefined;
      let report: Awaited<ReturnType<typeof runCoachSmoke>> | Awaited<ReturnType<typeof runStorageSmoke>> | Awaited<ReturnType<typeof runMigrationSmoke>> | Awaited<ReturnType<typeof runRecordsComparisonSmoke>> | Awaited<ReturnType<typeof runSettingsSmoke>> | Awaited<ReturnType<typeof runActivationSmoke>> | undefined;
      try {
        report = await Promise.race([
          activation ? runActivationSmoke({ window, snapshot: () => coach.snapshot(), command, activate: showCoach,
          failed: activationFailure, notifications: standardNotices, notificationEvents: this.noticeEvents }) : mode.settings ? runSettingsSmoke(window, () => coach.snapshot(), command, repository, coach) : comparison ? runRecordsComparisonSmoke(window) : migration ? runMigrationSmoke({ coach, window, repository }) : storage ? runStorageSmoke({ coach, observer, window, repository, workerPath: context.workerPath,
            verifyNotifications: async sample => {
              await stopObservation();
              const generation = await observer.start(); coach.begin(generation); coach.pauseNotifications(false);
              const before = coach.snapshot().counts[localDate()]?.W03?.mouse ?? 0;
              const offset = this.noticeResults.length;
              for (let sequence = 1; sequence <= 3; sequence++) {
                await observer.inject({ ...sample, generation, sequence, origin: 'mouse', route: 'max-button', monitor: null });
              }
              await coach.idle();
              const results = this.noticeResults.slice(offset);
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
              this.quitResponse = 0;
              try {
                await coach.setNormalBounds(window.getNormalBounds());
                await Promise.all([quit(), command('start'), quit(), command('retry-save')]);
                if (context.quitting || !coach.snapshot().pendingSave || coach.snapshot().observing || context.exitRequested) {
                  throw new Error('durable-quit-cancel-pending ' + JSON.stringify({ quitting: context.quitting, pending: coach.snapshot().pendingSave, observing: coach.snapshot().observing, exitRequested: context.exitRequested }));
                }
              } finally { repository.saveSettings = save; this.quitResponse = null; }
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
              this.quitResponse = 0;
              await Promise.all([quit(), quit()]);
              if (context.quitting || !coach.snapshot().pendingSave || coach.snapshot().observing || !window.isVisible()) throw new Error('quit-cancel-pending');
              repository.saveSettings = save;
              this.quitResponse = null;
              await coach.retrySave();
              if (coach.snapshot().pendingSave) throw new Error('quit-retry-save');
              const shutdown = observer.shutdown.bind(observer);
              observer.shutdown = async () => { throw new Error('fixture unconfirmed helper exit'); };
              await quit();
              observer.shutdown = shutdown;
              if (context.quitting || !window.isVisible()) throw new Error('quit-failure-recovery');
              await command('start');
              if (!coach.snapshot().observing) throw new Error('quit-failure-restart');
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => { this.tick = null; reject(new Error('quit-failure-ticker')); }, 3000);
                this.tick = () => { this.tick = null; clearTimeout(timeout); resolve(); };
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
        if (report && !storage) {
          app.once('will-quit', () => console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true, safeExit: true })));
          await Promise.all([quit(), quit()]);
          if (!context.quitting) { console.error('COACH_SMOKE_FAILED safe-exit'); app.exit(1); }
          return;
        }
        coach.stop(); notice.dismiss(); await observer.shutdown(); if (repository instanceof SqliteRepository) await repository.close(); context.quitting = true;
        if (report) console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true }));
        else console.error('COACH_SMOKE_FAILED');
        app.exit(report ? 0 : 1);
      }
    }
  }
}

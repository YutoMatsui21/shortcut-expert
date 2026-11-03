import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { DurableCoach, type Capability } from '../core/durable-coach';
import { localDate } from '../core/dates';
import type { SerialQueue } from '../core/serial-queue';
import { SqliteRepository } from './sqlite-repository';
import type { ObserverClient } from './observer';
import type { StandardNotifications, NotificationResult } from './standard-notification';
import type { StartupMode } from './startup-mode.ts';
import { runStorageSmoke } from './storage-smoke';
import { runMigrationSmoke } from './migration-smoke';
import { seedComparisonCoverage, runRecordsComparisonSmoke } from './records-comparison-smoke';
import { runSettingsSmoke } from './settings-smoke';
import { runActivationSmoke } from './activation-smoke';
import { runNotificationAcceptance } from './notification-acceptance';
import { runUiAcceptance } from './ui-acceptance';
import { runNaturalInputAcceptance, runTrialControl } from './natural-input-acceptance';
import { FinalInputTrials } from './final-input-trials';
import { loginItemName } from './login-startup';

type ValidationContext = {
  coach: DurableCoach; observer: ObserverClient;
  window: BrowserWindow; repository: SqliteRepository; workerPath: string;
  standardNotices: StandardNotifications;
  command(value: string): Promise<import('../shared/coach').Snapshot>;
  startObservation(): Promise<void>; stopObservation(): Promise<void>; quit(): Promise<void>;
  showCoach(): void; control: SerialQueue; readonly ticker: NodeJS.Timeout | undefined;
  quitting: boolean; readonly exitRequested: boolean;
};

// Loaded only for an explicit validation entry. It uses production commands and shutdown.
export class ValidationRuntime {
  naturalControl: ReturnType<typeof runNaturalInputAcceptance> | undefined;
  private naturalArming = false;
  quitResponse: number | null = null;
  private noticeResults: NotificationResult[] = [];
  private noticeEvents: EventEmitter[] = [];
  private mode: StartupMode;
  constructor(mode: StartupMode) { this.mode = mode; }
  get loginApi() {
    if (!this.mode.fixture) return undefined;
    // Replace only the Windows registration boundary; never touch the real Run key.
    let enabled = false;
    return {
      getLoginItemSettings: (options: { path: string; args: string[] }) => ({ openAtLogin: false, launchItems: enabled ? [{ name: loginItemName, scope: 'user', enabled, path: options.path.replace(/^"|"$/g, ''), args: options.args }] : [] }),
      setLoginItemSettings: (value: { openAtLogin: boolean }) => { enabled = value.openAtLogin; }
    };
  }
  // Migration verifies legacy data without adding fresh coverage through renderer snapshot reads.
  get canStartObservation() { return !this.mode.migration && (this.mode.naturalOperation === null || this.naturalArming); }
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
  async prepareRepository(repository: SqliteRepository) {
    if (this.mode.activationFailure) repository.load = async () => { throw new Error('fixture initialization failure'); };
    if (this.mode.comparison) {
      if (!(repository instanceof SqliteRepository)) throw new Error('Comparison fixture requires isolated SQLite');
      await seedComparisonCoverage(repository);
    }
  }
  async run(context: ValidationContext): Promise<void> {
    const mode = this.mode;
    const { fixture, osAcceptance, uiAcceptance, activation, activationFailure, comparison, migration } = mode;
    const naturalOperation = mode.naturalOperation ?? 'W08';
    const naturalAcceptance = !fixture && mode.naturalOperation !== null;
    const { coach, observer, window, repository, standardNotices,
      command, startObservation, stopObservation, quit, showCoach, control, ticker } = context;
    if (naturalAcceptance) {
      const deps = {
        snapshot: () => coach.snapshot(), start: paused => control.run(async () => {
          this.naturalArming = true; try { await startObservation(); coach.pauseNotifications(paused); } finally { this.naturalArming = false; }
        }), stop: () => control.run(stopObservation), idle: () => coach.idle(),
      } satisfies Pick<Parameters<typeof runNaturalInputAcceptance>[1], 'snapshot' | 'start' | 'stop' | 'idle'>;
      this.naturalControl = naturalOperation === 'ALL'
        ? runTrialControl(app.getPath('userData'), deps, quit, 'ALL', start => new FinalInputTrials({ ...deps, start, date: localDate,
          configure: async states => { for (const [op, state] of Object.entries(states)) await coach.setLearningState(op as import('../shared/coach').OperationId, state!); }
        }), true)
        : runNaturalInputAcceptance(app.getPath('userData'), { ...deps, configure: state => coach.setLearningState(naturalOperation, state) }, quit, naturalOperation);
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
      clearInterval(ticker);
      let deadline: NodeJS.Timeout | undefined;
      let report: Awaited<ReturnType<typeof runStorageSmoke>> | Awaited<ReturnType<typeof runMigrationSmoke>> | Awaited<ReturnType<typeof runRecordsComparisonSmoke>> | Awaited<ReturnType<typeof runSettingsSmoke>> | Awaited<ReturnType<typeof runActivationSmoke>> | undefined;
      try {
        report = await Promise.race([
          activation ? runActivationSmoke({ window, snapshot: () => coach.snapshot(), command, activate: showCoach,
          failed: activationFailure, stopped: mode.activationStopped, background: mode.background, notifications: standardNotices, notificationEvents: this.noticeEvents }) : mode.settings ? runSettingsSmoke(window, () => coach.snapshot(), command, repository, coach) : comparison ? runRecordsComparisonSmoke(window) : migration ? runMigrationSmoke({ coach, window, repository }) : runStorageSmoke({ coach, observer, window, repository, workerPath: context.workerPath,
            verifyNotifications: async sample => {
              await stopObservation();
              const generation = await observer.start(); coach.begin(generation); coach.pauseNotifications(false);
              const before = coach.snapshot().counts[localDate()]?.W03?.mouse ?? 0;
              const offset = this.noticeResults.length;
              for (let sequence = 1; sequence <= 3; sequence++) {
                await observer.inject({ ...sample, generation, sequence, transaction: sequence, origin: 'mouse', route: 'max-button' });
              }
              await coach.idle();
              const results = this.noticeResults.slice(offset);
              if (coach.snapshot().counts[localDate()]?.W03?.mouse !== before + 3 ||
                results.filter(value => value.status === 'requested').length !== 3 ||
                results.filter(value => value.status === 'api-returned').length !== 3 ||
                results.filter(value => value.status === 'show-event').length !== 3 ||
                new Set(results.map(value => value.id)).size !== 3) throw new Error('standard-notification-fixture');
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
          }),
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
        coach.stop(); await observer.shutdown(); await repository.close(); context.quitting = true;
        if (report) console.log('COACH_SMOKE_OK ' + JSON.stringify({ ...report, hooksStopped: true }));
        else console.error('COACH_SMOKE_FAILED');
        app.exit(report ? 0 : 1);
      }
    }
  }
}

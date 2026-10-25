import { naturalInputOperation } from './natural-input-mode.ts';

// Secondary smoke flags only select a runner after a fixture entry was requested.
export function startupMode(argv: readonly string[]) {
  const osAcceptance = argv.includes('--os-notification-acceptance');
  const uiAcceptance = argv.includes('--ui-acceptance');
  const migration = argv.includes('--migration-smoke');
  const fixture = osAcceptance || uiAcceptance || argv.includes('--coach-smoke') || argv.includes('--storage-smoke') || migration;
  const naturalOperation = naturalInputOperation(argv);
  const activation = fixture && argv.includes('--activation-smoke');
  return {
    fixture, osAcceptance, uiAcceptance, naturalOperation,
    validation: fixture || naturalOperation !== null,
    storage: osAcceptance || uiAcceptance || argv.includes('--storage-smoke') || migration,
    migration, activation,
    activationFailure: activation && argv.includes('--activation-failure-smoke'),
    comparison: fixture && argv.includes('--comparison-smoke'),
    settings: argv.includes('--settings-smoke'),
    uiExit: argv.includes('--ui-acceptance-exit'),
    get legacyRepository() { return fixture && !this.storage; },
    get showTray() { return !fixture || osAcceptance || uiAcceptance; },
    get systemNotifications() { return !fixture || osAcceptance; }
  };
}

export type StartupMode = ReturnType<typeof startupMode>;

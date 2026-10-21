// Local V02 test entry. No app startup, IPC, helper, observer or normal userData.
// Bundled with the product so the harness exercises the exact packaged modules.
export { SqliteRepository } from './sqlite-repository.ts';
export { StorageStore } from './storage-store.ts';
export { readLegacy } from './storage-migration.ts';
export { DurableCoach } from '../core/durable-coach.ts';

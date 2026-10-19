import type { Counts, OperationId, Settings } from './coach.ts';
export const recordOperations: OperationId[] = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W10', 'W11', 'W12', 'W13'];

export type Coverage = { knowledge: 'observed' | 'not-observed' | 'legacy-unknown'; activeMs: number; gap: boolean; capabilityRevision: string };
export type CoverageDays = Record<string, Partial<Record<OperationId, Coverage>>>;
export type RecordRange = { counts: Counts; coverage: CoverageDays; revision: number };
export type StorageState = RecordRange & { settings: Settings; epoch: number; highWater: string };
export type RecordMutation = {
  epoch: number; writeSession: string; sequence: number; today: string;
  count?: { day: string; operation: OperationId; origin: 'mouse' | 'key' };
  coverage: { day: string; operation: OperationId; value: Coverage }[];
  reset?: boolean;
};
export interface DurableRepository {
  load(today: string): Promise<StorageState>;
  commit(mutation: RecordMutation): Promise<void>;
  query(from: string, to: string): Promise<RecordRange>;
  saveSettings(settings: Settings): Promise<void>;
  reconnect(): Promise<void>;
  close(): Promise<void>;
}
export function daysBefore(day: string, amount: number): string {
  const date = new Date(day + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - amount);
  return date.toISOString().slice(0, 10);
}

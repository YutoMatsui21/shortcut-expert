import { app } from 'electron';
import { Coach, type Dependencies } from '../core/coach';
import { JsonRepository } from './repository';
import { localDate } from '../core/dates';
import { learningReadModel } from '../core/learning';
import { recordsReadModel } from '../core/records';
import { defaultRecordsQuery, type RecordsQuery } from '../shared/records';
import type { NotificationWindow } from './notification';

// Only ValidationRuntime loads this compatibility composition. Keep legacy smoke
// on its original Coach/JSON implementation while sharing production IPC/controls.
class LegacyFixtureRepository extends JsonRepository {
  async query(from: string, to: string) {
    const loaded = await this.load();
    return { counts: Object.fromEntries(Object.entries(loaded.counts).filter(([day]) => day >= from && day <= to)), coverage: {}, revision: 0 };
  }
  async close(): Promise<void> {}
}

class LegacyFixtureCoach extends Coach {
  async getRecordSummary(today: string, query: RecordsQuery = defaultRecordsQuery) {
    const snapshot = this.snapshot();
    return recordsReadModel({ counts: snapshot.counts, coverage: {}, revision: 0 }, snapshot.settings, today, query);
  }
  async getLearning(today: string) {
    const snapshot = this.snapshot();
    return learningReadModel({ counts: snapshot.counts, coverage: {}, revision: 0 }, snapshot.settings, today);
  }
}

export function createLegacyRuntime(common: Pick<Dependencies, 'date' | 'now' | 'changed'>, notice: NotificationWindow) {
  const repository = new LegacyFixtureRepository(app.getPath('userData'));
  const coach = new LegacyFixtureCoach({ ...common, repository, notify: value => notice.show(value) });
  let date = localDate();
  return { repository, coach, tick: () => {
    if (localDate() !== date) { date = localDate(); void coach.tick().then(() => common.changed(coach.snapshot())); }
  } };
}

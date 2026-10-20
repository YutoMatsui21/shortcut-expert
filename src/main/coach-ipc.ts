import { defaultRecordsQuery, isRecordsQuery } from '../shared/records.ts';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { operations, type CoachBridge } from '../shared/coach.ts';
import { validDate } from '../core/dates.ts';
import { daysBefore } from '../shared/storage.ts';
import { isLearningState, learningOperations } from '../shared/learning.ts';

type Requests = Pick<CoachBridge, 'getSnapshot' | 'getNotice' | 'command' | 'setMuted' | 'setLearningState' | 'deleteCounts' | 'getRecords' | 'getLearning' | 'getRecordSummary' | 'windowCommand'>;
type Command = Parameters<CoachBridge['command']>[0];

function isCommand(value: unknown): value is Command {
  return value === 'pause-notifications' || value === 'resume-notifications' || value === 'stop' ||
    value === 'start' || value === 'retry-save' || value === 'quit';
}

export function registerCoachIpc(getWindow: () => BrowserWindow | null, noticeSender: (id: number) => boolean, requests: Requests): void {
  const assertSender = (event: IpcMainInvokeEvent, notice = false) => {
    const allowed = notice ? noticeSender(event.sender.id) : event.sender === getWindow()?.webContents;
    if (!allowed || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown sender.');
  };
  ipcMain.handle('coach:get-snapshot', (event) => { assertSender(event); return requests.getSnapshot(); });
  ipcMain.handle('coach:get-learning', (event) => { assertSender(event); return requests.getLearning(); });
  ipcMain.handle('coach:get-record-summary', (event, query: unknown = defaultRecordsQuery) => {
    assertSender(event);
    if (!isRecordsQuery(query)) throw new Error('Invalid records query.');
    return requests.getRecordSummary({ period: query.period, filter: query.filter, sort: query.sort });
  });
  ipcMain.handle('coach:window', (event, value: unknown) => {
    assertSender(event);
    if (value !== 'minimize' && value !== 'maximize' && value !== 'hide') throw new Error('Unknown window command.');
    return requests.windowCommand(value);
  });
  ipcMain.handle('coach:get-records', (event, from: unknown, to: unknown) => {
    assertSender(event);
    if (typeof from !== 'string' || typeof to !== 'string' || !validDate(from) || !validDate(to) || from > to || to > daysBefore(from, -59) || !requests.getRecords) throw new Error('Invalid range.');
    return requests.getRecords(from, to);
  });
  ipcMain.handle('coach:get-notice', (event) => { assertSender(event, true); return requests.getNotice(); });
  ipcMain.handle('coach:command', (event, value: unknown) => {
    assertSender(event);
    if (!isCommand(value)) throw new Error('Unknown command.');
    return requests.command(value);
  });
  ipcMain.handle('coach:set-muted', (event, operation: unknown, muted: unknown) => {
    assertSender(event);
    const supported = operations.find((op) => op.id === operation);
    if (!supported || typeof muted !== 'boolean') throw new Error('Invalid setting.');
    return requests.setMuted(supported.id, muted);
  });
  ipcMain.handle('coach:set-learning-state', (event, operation: unknown, state: unknown) => {
    assertSender(event);
    const supported = learningOperations.find(op => op.id === operation);
    if (!supported || !isLearningState(state)) throw new Error('Invalid learning state.');
    return requests.setLearningState(supported.id, state);
  });
  ipcMain.handle('coach:delete', (event) => { assertSender(event); return requests.deleteCounts(); });
}

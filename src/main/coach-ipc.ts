import { defaultRecordsQuery, isRecordsQuery } from '../shared/records.ts';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { type CoachBridge } from '../shared/coach.ts';
import { validDate } from '../core/dates.ts';
import { daysBefore } from '../shared/storage.ts';
import { isLearningState, learningOperations } from '../shared/learning.ts';
import { DeleteConfirmation } from './delete-confirmation.ts';

type Requests = Pick<CoachBridge, 'getSnapshot' | 'command' | 'setLearningState' | 'deleteCounts' | 'getRecords' | 'getLearning' | 'getRecordSummary' | 'windowCommand'>;
type Command = Parameters<CoachBridge['command']>[0];

function isCommand(value: unknown): value is Command {
  return value === 'pause-notifications' || value === 'resume-notifications' || value === 'stop' ||
    value === 'start' || value === 'retry-save' || value === 'quit' || value === 'enable-startup' || value === 'disable-startup';
}

export function registerCoachIpc(getWindow: () => BrowserWindow | null, requests: Requests): void {
  const confirmation = new DeleteConfirmation();
  const boundWindows = new WeakSet<BrowserWindow>();
  const tokenArgument = (token: unknown): string => {
    if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid delete confirmation.');
    return token;
  };
  const assertSender = (event: IpcMainInvokeEvent) => {
    const allowed = event.sender === getWindow()?.webContents;
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
  ipcMain.handle('coach:command', (event, value: unknown) => {
    assertSender(event);
    if (!isCommand(value)) throw new Error('Unknown command.');
    return requests.command(value);
  });
  ipcMain.handle('coach:set-learning-state', (event, operation: unknown, state: unknown) => {
    assertSender(event);
    const supported = learningOperations.find(op => op.id === operation);
    if (!supported || !isLearningState(state)) throw new Error('Invalid learning state.');
    return requests.setLearningState(supported.id, state);
  });
  ipcMain.handle('coach:request-delete', (event) => {
    assertSender(event);
    const window = getWindow()!;
    if (!boundWindows.has(window)) {
      boundWindows.add(window);
      window.on('hide', () => confirmation.clear());
      window.on('closed', () => confirmation.clear());
      window.webContents.on('did-start-navigation', () => confirmation.clear());
    }
    return confirmation.issue(event.senderFrame!);
  });
  ipcMain.handle('coach:cancel-delete', (event, token: unknown) => {
    assertSender(event); confirmation.cancel(event.senderFrame!, tokenArgument(token));
  });
  ipcMain.handle('coach:delete', (event, token: unknown) => {
    assertSender(event);
    const value = tokenArgument(token);
    confirmation.consume(event.senderFrame!, value);
    return requests.deleteCounts(value);
  });
}

import { contextBridge, ipcRenderer } from 'electron';
import type { CoachBridge, Snapshot } from '../shared/coach';

const coach: CoachBridge = {
  getRecordSummary: (query) => ipcRenderer.invoke('coach:get-record-summary', query),
  getLearning: () => ipcRenderer.invoke('coach:get-learning'),
  windowCommand: (command) => ipcRenderer.invoke('coach:window', command),
  getRecords: (from, to) => ipcRenderer.invoke('coach:get-records', from, to),
  getSnapshot: () => ipcRenderer.invoke('coach:get-snapshot'),
  getNotice: () => ipcRenderer.invoke('coach:get-notice'),
  command: (command) => ipcRenderer.invoke('coach:command', command),
  setMuted: (operation, muted) => ipcRenderer.invoke('coach:set-muted', operation, muted),
  setLearningState: (operation, state) => ipcRenderer.invoke('coach:set-learning-state', operation, state),
  deleteCounts: () => ipcRenderer.invoke('coach:delete'),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('coach:changed', handler);
    return () => ipcRenderer.removeListener('coach:changed', handler);
  }
};
contextBridge.exposeInMainWorld('coach', coach);

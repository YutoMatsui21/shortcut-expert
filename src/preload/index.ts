import { contextBridge, ipcRenderer } from "electron";
import type { CoachBridge, Snapshot } from "../shared/coach";

const coach: CoachBridge = {
  getRecordSummary: (query) =>
    ipcRenderer.invoke("coach:get-record-summary", query),
  getLearning: () => ipcRenderer.invoke("coach:get-learning"),
  windowCommand: (command) => ipcRenderer.invoke("coach:window", command),
  getRecords: (from, to) => ipcRenderer.invoke("coach:get-records", from, to),
  getSnapshot: () => ipcRenderer.invoke("coach:get-snapshot"),
  command: (command) => ipcRenderer.invoke("coach:command", command),
  setLearningState: (operation, state) =>
    ipcRenderer.invoke("coach:set-learning-state", operation, state),
  requestDelete: () => ipcRenderer.invoke("coach:request-delete"),
  cancelDelete: (token) => ipcRenderer.invoke("coach:cancel-delete", token),
  deleteCounts: (token) => ipcRenderer.invoke("coach:delete", token),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) =>
      listener(snapshot);
    ipcRenderer.on("coach:changed", handler);
    return () => ipcRenderer.removeListener("coach:changed", handler);
  },
};
contextBridge.exposeInMainWorld("coach", coach);

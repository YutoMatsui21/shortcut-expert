import { parentPort, workerData } from 'node:worker_threads';
import { StorageStore } from './storage-store.ts';
let store: StorageStore;
try { store = new StorageStore(workerData.root); parentPort!.postMessage({ ready: true }); }
catch { parentPort!.postMessage({ ready: false }); parentPort!.close(); }
parentPort!.on('message', ({ id, action, args }) => {
  try {
    let result;
    switch (action) {
      case 'load': result = store.load(args[0]); break;
      case 'query': result = store.query(args[0], args[1]); break;
      case 'commit': result = store.commit(args[0]); break;
      case 'claim': result = store.claim(args[0]); break;
      case 'settings': result = store.saveSettings(args[0]); break;
      case 'close':
        store.close(); parentPort!.postMessage({ id, ok: true }); parentPort!.close(); return;
      default: throw new Error('UNKNOWN_REQUEST');
    }
    parentPort!.postMessage({ id, ok: true, result });
  } catch { parentPort!.postMessage({ id, ok: false }); }
});

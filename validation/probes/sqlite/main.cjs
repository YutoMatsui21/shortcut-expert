const { app } = require('electron');
const { Worker } = require('node:worker_threads');
const { join, resolve, isAbsolute } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
app.disableHardwareAcceleration();

// No windows, preload, input hooks or product Repository are loaded by this entry point.
const option = process.argv.indexOf('--sqlite-fixture');
const root = process.argv[option + 1];
if (option < 0 || !root || !isAbsolute(root) || readFileSync(join(root, '.sqlite-fixture'), 'utf8') !== 'T10 isolated fixture\n') {
  app.exit(2);
} else {
  app.setPath('userData', join(root, 'electron-data'));
  app.whenReady().then(() => {
  const action = process.argv[option + 2];
  const workerPath = resolve(__dirname.replace('app.asar', 'app.asar.unpacked'), 'worker.cjs');
  const worker = new Worker(workerPath, { workerData: { root, action } });
  let ticks = 0;
  const heartbeat = setInterval(() => writeFileSync(join(root, 'heartbeat.json'), JSON.stringify({ ticks: ++ticks })), 50);
  const timer = setTimeout(() => { app.exit(3); }, 25_000);
  function finish(result, code) {
    clearTimeout(timer);
    clearInterval(heartbeat);
    writeFileSync(join(root, 'result.json'), JSON.stringify({
      ...result, runtime: { ...process.versions, packaged: app.isPackaged, platform: process.platform, arch: process.arch },
      workerOutsideAsar: workerPath.includes('app.asar.unpacked')
    }, null, 2));
    app.exit(code);
  }
  let response;
  worker.once('message', (result) => { response = result; });
  // Wait for Node's Worker teardown before Electron tears down its V8 runtime.
  worker.once('exit', (code) => {
    if (response) finish(response, code === 0 ? 0 : 1);
    else finish({ error: 'Worker exited without a response' }, 1);
  });
  worker.once('error', (error) => finish({ error: error.message, stack: error.stack }, 1));
  });
}

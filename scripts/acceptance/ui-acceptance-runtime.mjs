import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function packageManifest(root) {
  const walk = relative => readdirSync(join(root,relative),{withFileTypes:true}).flatMap(entry => {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) throw new Error('Unsupported package entry: ' + path);
    return [{path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}];
  });
  return walk('').sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function waitForUiAcceptance(child, log, timeoutMs = 0) {
  let output = '';
  const record = chunk => { output += chunk; log(chunk); };
  child.stdout.on('data',record); child.stderr.on('data',record);
  return new Promise(resolve => {
    let timer;
    let timedOut = false;
    const finish = code => { clearTimeout(timer); resolve(code); };
    child.on('error',error => { log(error.message); finish(1); });
    // exit may precede the last stdout data; close follows stream drainage.
    child.on('close',code => finish(!timedOut && code === 0 && output.includes('V03_READY') ? 0 : 1));
    if (timeoutMs > 0) timer = setTimeout(() => {
      timedOut = true;
      log('V03_MATRIX_TIMEOUT\n');
      child.kill();
      child.stdout.destroy?.(); child.stderr.destroy?.(); child.unref();
      finish(1);
    },timeoutMs);
  });
}

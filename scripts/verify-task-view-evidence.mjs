// Offline source-integrity check; never compile or execute historical probe sources.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const evidence = new URL('../validation/evidence/', import.meta.url);
try {
  const summary = JSON.parse(await readFile(new URL('task-view-summary-20261022.json', evidence), 'utf8'));
  if (summary.verdict !== 'unknown' || summary.acceptancePassed !== false) throw new Error('Invalid research verdict');
  let count = 0;
  for (const capture of summary.captures) {
    if (!/^[a-f0-9]{64}$/.test(capture.sourceSha256)) throw new Error('Invalid source hash');
    const bytes = await readFile(new URL(`task-view-sources/${capture.sourceSha256}.cs.txt`, evidence));
    if (createHash('sha256').update(bytes).digest('hex') !== capture.sourceSha256) throw new Error('Source hash mismatch');
    count++;
  }
  console.log(`TASK_VIEW_EVIDENCE_SOURCE_HASHES_OK (${count} captures; no live observation)`);
} catch { console.error('TASK_VIEW_EVIDENCE_SOURCE_HASHES_FAILED'); process.exitCode = 1; }

import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { HelperProcess } from './support/helper-process.ts';
import { candidateFixture, v2Fixture } from './support/fixtures.ts';

let launched: HelperProcess[] = [];
let sendReady = true;
let readyVersion = 2;
let supportedProtocols: number[] | undefined;
mock.module('electron', { namedExports: { app: { isPackaged: false, getAppPath: () => '.' } } });
mock.module('node:child_process', { namedExports: { spawn: () => {
  const process = new HelperProcess(); launched.push(process);
  if (sendReady) queueMicrotask(() => process.send({ type: 'ready', protocolVersion: readyVersion, arrangedAvailable: true, supportedProtocols })); return process;
} } });
const { ObserverClient, candidateV2 } = await import('../src/main/observer.ts');

function harness(t: TestContext) {
  launched = []; sendReady = true; readyVersion = 2; supportedProtocols = undefined;
  const accepted: unknown[] = [];
  let faults = 0;
  const client = new ObserverClient((value) => accepted.push(value), () => { faults++; }, true);
  t.after(() => { launched.forEach((child) => child.dispose()); sendReady = true; readyVersion = 2; });
  return { client, accepted, faults: () => faults, child: () => launched.at(-1)! };
}

test('旧readyはv2広告があっても後方互換起動せず直ちに停止する', async t => {
  const h = harness(t); readyVersion = 1; supportedProtocols = [1, 2];
  await assert.rejects(h.client.start(), /helper-failed/);
  assert.equal(h.child().requests.length, 0);
  assert.equal(h.child().killed, true);
});

test('ready待ちのhelper異常終了はタイムアウトを待たず失敗する', async (t) => {
  const h = harness(t); sendReady = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starting = h.client.start();
  const failed = assert.rejects(starting, /helper-failed/);
  h.child().exit(1);
  // A valid ready arriving later must not complete an already failed startup.
  t.mock.timers.tick(5000);
  await failed;
  assert.equal(h.faults(), 1);
});

test('v2で開始し、同じ世代の旧候補は停止理由にする', async (t) => {
  const h = harness(t); await h.client.start();
  assert.equal(h.child().requests[0].protocolVersion, 2);
  h.child().send(v2Fixture());
  assert.deepEqual(h.accepted, [v2Fixture()]);
  h.child().send(candidateFixture({ sequence: 2 }));
  assert.equal(h.faults(), 1); assert.equal(h.child().killed, true);
});

test('v2通信の不足証拠はhelper停止へ伝わる', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().send({ ...v2Fixture(), evidence: { kind: 'window' } });
  assert.deepEqual(h.accepted, []); assert.equal(h.faults(), 1);
});

test('fixture照会に別typeの応答を返すhelperは停止し照会を失敗させる', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().respond = (request) => h.child().send({
    type: 'started', requestId: request.requestId, result: 'fixture-before'
  });
  await assert.rejects(h.client.focusToken(), /helper-failed/);
  assert.equal(h.child().killed, true);
  assert.equal(h.faults(), 1);
});

test('window証拠は必須項目・有限値を確認し余分な内容を転送しない', () => {
  const value = v2Fixture();
  if (value.evidence.kind !== 'window') throw new Error('fixture');
  const result = value.evidence.result;
  for (const invalid of [{ before: null }, { inputAgeMs: Infinity }, { inputAgeMs: NaN },
    { afterArranged: 'false' }, { fromMonitor: [] }, { moveDirection: 'up' }, { moveConfirmed: 'true' },
    { monitor: { x: 0, y: 0, width: 0, height: 10 } }, { toMonitor: { x: 0, y: Infinity, width: 10, height: 10 } }])
    assert.equal(candidateV2({ ...value, evidence: { ...value.evidence, result: { ...result, ...invalid } } }), null);
  const parsed = candidateV2({ ...value, title: 'fixture-sensitive', keys: ['fixture-key'],
    evidence: { ...value.evidence, result: { ...result, path: 'private' } } });
  assert.deepEqual(parsed, value);
  assert.equal(candidateV2(candidateFixture()), null, 'v1 transport has been retired');
});

test('停止中・旧世代の候補を無視し新世代だけ転送する', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().send(v2Fixture());
  await h.client.stop(); h.child().send(v2Fixture(candidateFixture({ sequence: 2 })));
  assert.equal(await h.client.start(), 2);
  h.child().send(v2Fixture(candidateFixture({ sequence: 3 })));
  h.child().send(v2Fixture(candidateFixture({ generation: 2 })));
  assert.deepEqual(h.accepted, [v2Fixture(), v2Fixture(candidateFixture({ generation: 2 }))]);
  await h.client.shutdown();
});

test('分割chunk・連続JSON行を組み立て誤ったrequestIdでは要求を完了しない', async (t) => {
  const h = harness(t); await h.client.start();
  const encoded = JSON.stringify(v2Fixture());
  h.child().stdout.write(encoded.slice(0, 17));
  assert.equal(h.accepted.length, 0);
  h.child().stdout.write(encoded.slice(17) + '\n' + JSON.stringify(v2Fixture(candidateFixture({ sequence: 2 }))) + '\n');
  assert.equal(h.accepted.length, 2);
  h.child().respond = null;
  let completed = false;
  const query = h.client.focusToken().then((value) => { completed = true; return value; });
  const id = h.child().requests.at(-1)!.requestId;
  h.child().send({ type: 'focus', requestId: id + 1, result: 'fixture-before' });
  await Promise.resolve(); assert.equal(completed, false);
  h.child().send({ type: 'focus', requestId: id, result: 'fixture-after' });
  assert.equal(await query, 'fixture-after');
  h.child().respond = (request) => { h.child().send({ type: 'stopped', requestId: request.requestId }); h.child().exit(); };
  await h.client.shutdown();
});

for (const [name, text] of [['不正JSON', '{bad}\n'], ['必須項目欠落', '{"type":"candidate"}\n'], ['巨大な行', 'x'.repeat(16385) + '\n']]) {
  test(`${name}を受けたら保留要求を失敗させてhelperを停止する`, async (t) => {
    const h = harness(t); await h.client.start(); h.child().respond = null;
    const query = h.client.focusToken();
    const failed = assert.rejects(query, /helper-failed/);
    h.child().stdout.write(text);
    await failed;
    assert.equal(h.faults(), 1); assert.equal(h.child().killed, true); assert.deepEqual(h.accepted, []);
  });
}

test('要求timeout後の応答を後続要求へ流用しない', async (t) => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const query = h.client.focusToken();
  const rejected = assert.rejects(query, /helper-request-timeout/);
  const expired = h.child().requests.at(-1)!.requestId;
  t.mock.timers.tick(2500); await rejected;
  const next = h.client.focusToken();
  const current = h.child().requests.at(-1)!.requestId;
  h.child().send({ type: 'focus', requestId: expired, result: 'fixture-before' });
  h.child().send({ type: 'focus', requestId: current, result: 'fixture-current' });
  assert.equal(await next, 'fixture-current');
});

test('停止解除の応答が期限内に来ない場合は停止を返しhelperを終了させる', async (t) => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped = assert.rejects(h.client.stop(), /helper-stop-failed/);
  t.mock.timers.tick(2500); await stopped;
  assert.equal(h.child().killed, true); assert.equal(h.faults(), 1);
});

test('shutdown waits for the retired helper exit after stop failure', async t => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped = assert.rejects(h.client.stop(), /helper-stop-failed/);
  t.mock.timers.tick(2500); await stopped;
  let finished = false;
  const shutting = h.client.shutdown().then(() => { finished = true; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(finished, false, 'kill request is not process exit');
  h.child().exit(1); await shutting;
  assert.equal(finished, true);
});

test('子プロセスの終了とstdin失敗はfixture照会を失敗させる', async (t) => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  const failed = assert.rejects(h.client.focusToken(), /helper-failed/);
  h.child().exit(1); await failed;
  await h.client.start(); h.child().writeError = new Error('fixture-pipe-closed');
  await assert.rejects(h.client.focusToken(), /fixture-pipe-closed/);
});

test('本番clientでは人工候補注入を拒否する', async () => {
  const client = new ObserverClient(() => {}, () => {});
  await assert.rejects(client.inject(v2Fixture()), /fixture-only/);
  await assert.rejects(client.focusToken(), /fixture-only/);
});

test('shutdownの応答だけで終えずhelperのexitを確認する', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().respond = (request) => h.child().send({ type: 'stopped', requestId: request.requestId });
  let finished = false;
  const shutting = h.client.shutdown().then(() => { finished = true; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(finished, false, 'ack is not process exit');
  h.child().exit(); await shutting;
  assert.equal(finished, true);
});

test('shutdown応答後も終了しないhelperを期限で強制終了する', async (t) => {
  const h = harness(t); await h.client.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.child().respond = (request) => h.child().send({ type: 'stopped', requestId: request.requestId });
  const shutting = h.client.shutdown();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(2499); assert.equal(h.child().killed, false);
  t.mock.timers.tick(1);
  h.child().exit(); await shutting;
  assert.equal(h.child().killed, true); assert.equal(h.faults(), 0);
});

test('shutdown rejects if kill does not produce a confirmed exit; a later retry can finish', async t => {
  const h = harness(t); await h.client.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.child().respond = request => h.child().send({ type: 'stopped', requestId: request.requestId });
  const shutting = assert.rejects(h.client.shutdown(), /helper-exit-unconfirmed/);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(5000); await shutting;
  h.child().exit(); await h.client.shutdown();
});

test('改行が来ない巨大chunkでも受信中に停止する', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().stdout.write('x'.repeat(16385));
  assert.equal(h.child().killed, true);
  assert.equal(h.faults(), 1);
});

test('通信候補は正の32bit IDと文字列の入力由来を要求する', () => {
  for (const invalid of [
    { generation: 0 }, { generation: -1 }, { generation: 2 ** 31 },
    { sequence: 0 }, { sequence: 1.5 }, { origin: ['mouse'] }
  ]) assert.equal(candidateV2({ ...v2Fixture(), ...invalid }), null, JSON.stringify(invalid));
});

test('古いhelperの終了が再開したhelperを停止させない', async (t) => {
  launched = [];
  let faults = 0;
  const accepted: number[] = [];
  const client = new ObserverClient((value) => accepted.push(value.generation), () => { faults++; }, true);
  t.after(() => launched.forEach((child) => child.dispose()));
  assert.equal(await client.start(), 1);
  const old = launched[0];
  old.send({ type: 'fault', reason: 'synthetic-fault' });
  assert.equal(faults, 1);
  const restarting = client.start();
  // The killed process exits after its replacement is already running.
  old.exit(1);
  assert.equal(await restarting, 2);
  const current = launched[1];
  current.send(v2Fixture(candidateFixture({ generation: 2 })));
  assert.equal(current.killed, false);
  assert.equal(faults, 1);
  assert.deepEqual(accepted, [2]);
  await client.shutdown();
});

test('fixture focusの不正結果を正常なtokenへ変換しない', async t => {
  const h = harness(t); await h.client.start();
  h.child().respond = request => h.child().send({ type: 'focus', requestId: request.requestId, result: null });
  await assert.rejects(h.client.focusToken(), /invalid-focus-token/);
});

import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { HelperProcess } from './support/helper-process.ts';
import { candidateFixture, v2Fixture } from './support/fixtures.ts';

let launched: HelperProcess[] = [];
let sendReady = true;
let readyVersion = 1;
let supportedProtocols: number[] | undefined;
mock.module('electron', { namedExports: { app: { isPackaged: false, getAppPath: () => '.' } } });
mock.module('node:child_process', { namedExports: { spawn: () => {
  const process = new HelperProcess(); launched.push(process);
  if (sendReady) queueMicrotask(() => process.send({ type: 'ready', protocolVersion: readyVersion, arrangedAvailable: true, supportedProtocols })); return process;
} } });
const { ObserverClient, candidate } = await import('../src/main/observer.ts');

function harness(t: TestContext) {
  launched = []; sendReady = true; readyVersion = 1; supportedProtocols = undefined;
  const accepted: unknown[] = [];
  let faults = 0;
  const client = new ObserverClient((value) => accepted.push(value), () => { faults++; }, true);
  t.after(() => { launched.forEach((child) => child.dispose()); sendReady = true; readyVersion = 1; });
  return { client, accepted, faults: () => faults, child: () => launched.at(-1)! };
}

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

test('v2能力を広告したhelperだけv2で開始し、同じ世代の旧候補は停止理由にする', async (t) => {
  const h = harness(t); supportedProtocols = [1, 2]; await h.client.start();
  assert.equal(h.child().requests[0].protocolVersion, 2);
  h.child().send(v2Fixture());
  assert.deepEqual(h.accepted, [v2Fixture()]);
  h.child().send(candidateFixture({ sequence: 2 }));
  assert.equal(h.faults(), 1); assert.equal(h.child().killed, true);
});

test('v2通信の不足証拠はhelper停止へ伝わる', async (t) => {
  const h = harness(t); supportedProtocols = [1, 2]; await h.client.start();
  h.child().send({ ...v2Fixture(), evidence: { kind: 'window' } });
  assert.deepEqual(h.accepted, []); assert.equal(h.faults(), 1);
});

test('画面照会に別typeの応答を返すhelperは停止し照会を失敗させる', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().respond = (request) => h.child().send({
    type: 'started', requestId: request.requestId, result: { known: true, fullscreen: false }
  });
  await assert.rejects(h.client.context(candidateFixture().monitor!), /helper-failed/);
  assert.equal(h.child().killed, true);
  assert.equal(h.faults(), 1);
});

test('候補の検証は必須項目・有限値を確認し余分な内容を転送しない', () => {
  for (const value of [null, [], { ...candidateFixture(), protocolVersion: 2 },
    { ...candidateFixture(), before: null }, { ...candidateFixture(), conflicted: 0 },
    { ...candidateFixture(), inputAgeMs: Infinity }, { ...candidateFixture(), inputAgeMs: NaN }])
    assert.equal(candidate(value), null);
  const parsed = candidate({ ...candidateFixture(), title: 'fixture-sensitive', keys: ['fixture-key'] });
  assert.deepEqual(parsed, candidateFixture());
  assert.equal(candidate(candidateFixture({ monitor: { x: 0, y: 0, width: 0, height: 10 } }))?.monitor, null);
});

test('追加操作の状態・画面・方向を検証し、窓タイトルなどを転送しない', () => {
  const move = { ...candidateFixture(), operation: 'monitor-move', afterArranged: false,
    fromMonitor: { x: -1920, y: 0, width: 1920, height: 1080 },
    toMonitor: { x: 0, y: 0, width: 1920, height: 1080 }, moveDirection: 'right' };
  assert.deepEqual(candidate({ ...move, title: 'private', path: 'private' }), move);
  for (const invalid of [{ afterArranged: 'false' }, { fromMonitor: [] }, { toMonitor: { x: 0, y: 0, width: -1, height: 1080 } },
    { moveDirection: 'up' }, { moveConfirmed: 'true' }, { toMonitor: { ...move.toMonitor, y: Infinity } }]) assert.equal(candidate({ ...move, ...invalid }), null);
  assert.equal(candidate({ ...move, moveConfirmed: true })?.moveConfirmed, true);
  assert.equal(candidate({ ...move, moveDirection: null })?.moveDirection, null);
});

test('停止中・旧世代の候補を無視し新世代だけ転送する', async (t) => {
  const h = harness(t); await h.client.start();
  h.child().send(candidateFixture());
  await h.client.stop(); h.child().send(candidateFixture({ sequence: 2 }));
  assert.equal(await h.client.start(), 2);
  h.child().send(candidateFixture({ sequence: 3 }));
  h.child().send(candidateFixture({ generation: 2 }));
  assert.deepEqual(h.accepted, [candidateFixture(), candidateFixture({ generation: 2 })]);
  await h.client.shutdown();
});

test('分割chunk・連続JSON行を組み立て誤ったrequestIdでは要求を完了しない', async (t) => {
  const h = harness(t); await h.client.start();
  const encoded = JSON.stringify(candidateFixture());
  h.child().stdout.write(encoded.slice(0, 17));
  assert.equal(h.accepted.length, 0);
  h.child().stdout.write(encoded.slice(17) + '\n' + JSON.stringify(candidateFixture({ sequence: 2 })) + '\n');
  assert.equal(h.accepted.length, 2);
  h.child().respond = null;
  let completed = false;
  const query = h.client.context(candidateFixture().monitor!).then((value) => { completed = true; return value; });
  const id = h.child().requests.at(-1)!.requestId;
  h.child().send({ type: 'displayContext', requestId: id + 1, result: { known: true, fullscreen: false } });
  await Promise.resolve(); assert.equal(completed, false);
  h.child().send({ type: 'displayContext', requestId: id, result: { known: true, fullscreen: true } });
  assert.deepEqual(await query, { known: true, fullscreen: true });
  h.child().respond = (request) => { h.child().send({ type: 'stopped', requestId: request.requestId }); h.child().exit(); };
  await h.client.shutdown();
});

for (const [name, text] of [['不正JSON', '{bad}\n'], ['必須項目欠落', '{"type":"candidate"}\n'], ['巨大な行', 'x'.repeat(16385) + '\n']]) {
  test(`${name}を受けたら保留要求を失敗させてhelperを停止する`, async (t) => {
    const h = harness(t); await h.client.start(); h.child().respond = null;
    const query = h.client.context(candidateFixture().monitor!);
    const failed = assert.rejects(query, /helper-failed/);
    h.child().stdout.write(text);
    await failed;
    assert.equal(h.faults(), 1); assert.equal(h.child().killed, true); assert.deepEqual(h.accepted, []);
  });
}

test('要求timeout後の応答を後続要求へ流用しない', async (t) => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const query = h.client.context(candidateFixture().monitor!);
  const rejected = assert.rejects(query, /helper-request-timeout/);
  const expired = h.child().requests.at(-1)!.requestId;
  t.mock.timers.tick(2500); await rejected;
  const next = h.client.context(candidateFixture().monitor!);
  const current = h.child().requests.at(-1)!.requestId;
  h.child().send({ type: 'displayContext', requestId: expired, result: { known: true, fullscreen: false } });
  h.child().send({ type: 'displayContext', requestId: current, result: { known: false } });
  assert.deepEqual(await next, { known: false, fullscreen: true });
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

test('子プロセスの終了とstdin失敗は画面照会を失敗させる', async (t) => {
  const h = harness(t); await h.client.start(); h.child().respond = null;
  const failed = assert.rejects(h.client.context(candidateFixture().monitor!), /helper-failed/);
  h.child().exit(1); await failed;
  await h.client.start(); h.child().writeError = new Error('fixture-pipe-closed');
  await assert.rejects(h.client.context(candidateFixture().monitor!), /fixture-pipe-closed/);
});

test('本番clientでは人工候補注入を拒否する', async () => {
  const client = new ObserverClient(() => {}, () => {});
  await assert.rejects(client.inject(candidateFixture()), /fixture-only/);
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
  ]) assert.equal(candidate({ ...candidateFixture(), ...invalid }), null, JSON.stringify(invalid));
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
  current.send(candidateFixture({ generation: 2 }));
  assert.equal(current.killed, false);
  assert.equal(faults, 1);
  assert.deepEqual(accepted, [2]);
  await client.shutdown();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsReadModel } from '../src/core/records.ts';
import type { RecordRange } from '../src/shared/storage.ts';

const settings = { muted: [], opened: true };
test('7 local calendar days: weighted KPI, eleven rows, legacy values, no synthetic zeros', () => {
  const records: RecordRange = { counts: {
    '2024-02-28': { W03: { mouse: 100, key: 100 } },
    '2024-02-29': { W03: { mouse: 3, key: 1 }, W01: { mouse: 0, key: 6 }, W09: { mouse: 100, key: 100 }, W13: { mouse: 50, key: 50 } },
    '2024-03-06': { W03: { mouse: 1, key: 0 } },
    '2024-03-07': { W03: { mouse: 100, key: 100 } }
  }, coverage: { '2024-03-06': {
    W02: { knowledge: 'observed', activeMs: 1000, gap: true, capabilityRevision: 'fixture' },
    W13: { knowledge: 'not-observed', activeMs: 0, gap: true, capabilityRevision: 'unverified' }
  } }, revision: 19 };
  const original = structuredClone(records);
  const value = recordsReadModel(records, settings, '2024-03-06');
  assert.equal(value.from, '2024-02-29'); assert.equal(value.to, '2024-03-06'); assert.equal(value.revision, 19);
  assert.equal(value.rows.length, 11);
  assert.deepEqual(value.summary, { mouse: 4, key: 7, total: 11, rate: 63.6, barRate: 7 / 11 * 100 });
  assert.equal(value.rows.find(row => row.id === 'W03')?.rate, 20);
  assert.equal(value.rows.find(row => row.id === 'W02')?.total, 0);
  assert.equal(value.rows.find(row => row.id === 'W02')?.rate, null);
  assert.equal(value.rows.some(row => row.id === 'W13'), false);
  assert.deepEqual(records, original);
});
test('empty, observed zero and valid zero percent remain distinct', () => {
  const records: RecordRange = { counts: {}, coverage: {}, revision: 0 };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, null);
  records.coverage['2026-01-01'] = { W03: { knowledge: 'observed', activeMs: 1, gap: true, capabilityRevision: 'fixture' } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, 0);
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.rate, null);
  records.counts['2026-01-01'] = { W03: { mouse: 8, key: 0 } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.rate, 0);
  assert.equal(recordsReadModel(records, settings, '2026-01-08').summary.total, null);
});
test('BigInt rounding, unrounded bar and aggregate overflow across operations', () => {
  const records: RecordRange = { counts: { '2026-01-01': { W03: { mouse: 29, key: 3 } } }, coverage: {}, revision: 0 };
  const value = recordsReadModel(records, settings, '2026-01-01');
  assert.equal(value.summary.rate, 9.4); assert.equal(value.summary.barRate, 9.375);
  records.counts['2026-01-01'] = { W03: { mouse: Number.MAX_SAFE_INTEGER - 1, key: 1 } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, Number.MAX_SAFE_INTEGER);
  records.counts['2026-01-01'].W01 = { mouse: 1, key: 0 };
  assert.throws(() => recordsReadModel(records, settings, '2026-01-01'), /安全/);
});
import { recordRanges } from '../src/core/records.ts';
import { defaultRecordsQuery, type RecordsQuery } from '../src/shared/records.ts';
import { learningOperations } from '../src/shared/learning.ts';
import { daysBefore } from '../src/shared/storage.ts';
import type { Settings } from '../src/shared/coach.ts';
const empty = (): RecordRange => ({counts: {}, coverage: {}, revision: 3});
const query = (value: Partial<RecordsQuery>): RecordsQuery => ({...defaultRecordsQuery, ...value});

test('calendar ranges include both endpoints across leap day/year and stay within 60 days', () => {
  assert.deepEqual(recordRanges('2026-10-17', 7), {from:'2026-10-11',to:'2026-10-17',priorFrom:'2026-10-04',priorTo:'2026-10-10'});
  assert.deepEqual(recordRanges('2026-10-17', 30), {from:'2026-09-18',to:'2026-10-17',priorFrom:'2026-08-19',priorTo:'2026-09-17'});
  assert.equal(recordRanges('2024-03-01', 30).priorFrom, '2024-01-02');
  assert.equal(recordRanges('2026-01-01', 7).priorFrom, '2025-12-19');
  const records = empty();
  for (const day of ['2026-08-18','2026-08-19','2026-09-17','2026-09-18','2026-10-17','2026-10-18']) records.counts[day] = {W03:{mouse:1,key:0}};
  const value = recordsReadModel(records, settings, '2026-10-17', query({period:30}));
  assert.equal(value.summary.total, 2); assert.equal(value.previous.total, 2);
});

test('three filters apply current states to both periods, rows/KPIs/coverage without modifying saved counts', () => {
  const records = empty();
  for (let day = '2026-10-04'; day <= '2026-10-17'; day = daysBefore(day, -1)) records.coverage[day] = {
    W03:{knowledge:'observed',activeMs:86400000,gap:false,capabilityRevision:'fixture'},
    W05:{knowledge:'observed',activeMs:86400000,gap:false,capabilityRevision:'fixture'}
  };
  records.counts['2026-10-10'] = {W03:{mouse:3,key:1},W05:{mouse:4,key:0},W11:{mouse:100,key:0}};
  records.counts['2026-10-17'] = {W03:{mouse:1,key:3},W05:{mouse:0,key:4},W11:{mouse:200,key:0}};
  const original = structuredClone(records);
  const states: Settings = {muted:[],opened:true,states:Object.fromEntries(learningOperations.map(op => [op.id, 'excluded']))};
  states.states!.W03 = 'learning'; states.states!.W05 = 'mastered';
  const combined = recordsReadModel(records, states, '2026-10-17');
  assert.deepEqual(new Set(combined.rows.map(row=>row.id)), new Set(['W03','W05']));
  assert.equal(combined.summary.rate,87.5);assert.equal(combined.previous.rate,12.5);
  assert.equal(combined.comparison.improvement,75);assert.equal(combined.comparison.hasMissingCoverage,false);
  const learning = recordsReadModel(records, states, '2026-10-17',query({filter:'learning'}));
  assert.deepEqual(learning.rows.map(row=>row.id),['W03']); assert.equal(learning.comparison.improvement,50);
  const all = recordsReadModel(records, states, '2026-10-17',query({filter:'all'}));
  assert.equal(all.rows.length,11);assert.equal(all.summary.mouse,201);assert.equal(all.previous.mouse,107);
  assert.equal(all.comparison.hasMissingCoverage,true);
  states.states!.W03='excluded';
  const none = recordsReadModel(records,states,'2026-10-17',query({filter:'learning'}));
  assert.equal(none.rows.length,0);assert.equal(none.summary.total,null);assert.equal(none.previous.total,null);
  assert.equal(none.comparison.improvement,null);assert.equal(none.comparison.hasMissingCoverage,false);
  assert.deepEqual(records,original);
});

test('J01: legacy/gaps compare acquired values; missing evidence and observed zero are distinct', () => {
  const records = empty(); records.counts['2026-10-17']={W03:{mouse:3,key:1}};
  let value = recordsReadModel(records,settings,'2026-10-17');
  assert.equal(value.comparison.total,null);assert.equal(value.comparison.improvement,null);assert.equal(value.comparison.hasMissingCoverage,true);
  records.coverage['2026-10-10']={W03:{knowledge:'observed',activeMs:1000,gap:true,capabilityRevision:'fixture'}};
  value = recordsReadModel(records,settings,'2026-10-17');
  assert.equal(value.previous.total,0);assert.equal(value.comparison.total,4);assert.equal(value.comparison.improvement,null);
  records.counts['2026-10-10']={W03:{mouse:1,key:3}};
  value=recordsReadModel(records,settings,'2026-10-17');
  assert.equal(value.comparison.improvement,-50);assert.equal(value.comparison.hasMissingCoverage,true);
  delete records.counts['2026-10-17'];
  records.coverage['2026-10-17']={W03:{knowledge:'observed',activeMs:1,gap:true,capabilityRevision:'fixture'}};
  value=recordsReadModel(records,settings,'2026-10-17');
  assert.equal(value.comparison.total,-4);assert.equal(value.comparison.improvement,null);
  delete records.coverage['2026-10-17'];
  assert.equal(recordsReadModel(records,settings,'2026-10-17').comparison.total,null);
});

test('five sorts put null last, preserve exact ties in registry order, and use unrounded rational values', () => {
  const records=empty();
  records.counts['2026-10-17']={W12:{mouse:2,key:2},W01:{mouse:2,key:2},W03:{mouse:3,key:1},W05:{mouse:0,key:4}};
  records.counts['2026-10-10']={W12:{mouse:3,key:1},W01:{mouse:3,key:1},W03:{mouse:0,key:4},W05:{mouse:1,key:3}};
  const order=(sort:RecordsQuery['sort'])=>recordsReadModel(records,settings,'2026-10-17',query({sort})).rows.slice(0,4).map(r=>r.id);
  assert.deepEqual(order('rate'),['W03','W12','W01','W05']);
  assert.deepEqual(order('mouse'),['W03','W12','W01','W05']);
  assert.deepEqual(order('key'),['W05','W12','W01','W03']);
  assert.deepEqual(order('total'),['W12','W01','W03','W05']);
  assert.deepEqual(order('improvement'),['W12','W01','W05','W03']);
  records.counts['2026-10-17']={W12:{mouse:999,key:1001},W01:{mouse:1997,key:2003}};
  records.counts['2026-10-10']={W12:{mouse:1,key:1},W01:{mouse:1,key:1}};
  const improved=recordsReadModel(records,settings,'2026-10-17',query({sort:'improvement'}));
  assert.deepEqual(improved.rows.slice(0,2).map(r=>r.id),['W01','W12']);
  assert.deepEqual(improved.rows.slice(0,2).map(r=>r.comparison.improvement),[0.1,0.1]);
  assert.deepEqual(order('rate').slice(0,2),['W12','W01']);
  // Near safe-integer limits both rates collapse to the same Number but the fractions differ.
  records.counts['2026-10-17']={W12:{mouse:1,key:4503599627370495},W01:{mouse:1,key:4503599627370494}};
  const exact=recordsReadModel(records,settings,'2026-10-17');
  assert.equal(exact.summary.total,Number.MAX_SAFE_INTEGER);
  assert.equal(exact.rows[0].barRate,exact.rows[1].barRate);
  assert.deepEqual(exact.rows.slice(0,2).map(r=>r.id),['W01','W12']);
});

test('pt rounding is symmetric at halfway values and normalizes negative zero', () => {
  const records=empty();
  records.counts['2026-10-17']={W03:{mouse:1999,key:1},W05:{mouse:1,key:0},W04:{mouse:1,key:0}};
  records.counts['2026-10-10']={W03:{mouse:1,key:0},W05:{mouse:1999,key:1},W04:{mouse:3999,key:1}};
  const value=recordsReadModel(records,settings,'2026-10-17');
  assert.equal(value.rows.find(r=>r.id==='W03')?.comparison.improvement,0.1);
  assert.equal(value.rows.find(r=>r.id==='W05')?.comparison.improvement,-0.1);
  assert.equal(value.rows.find(r=>r.id==='W04')?.comparison.improvement,0);
  assert.equal(Object.is(value.rows.find(r=>r.id==='W04')?.comparison.improvement,-0),false);
});

test('coverage uses local calendar day duration across DST, without filling unobserved days', () => {
  const originalTZ=process.env.TZ;
  try {
    process.env.TZ='America/New_York';
    const records=empty();
    for(let day='2024-03-03';day<='2024-03-16';day=daysBefore(day,-1)) records.coverage[day]={
      W03:{knowledge:'observed',activeMs:(day==='2024-03-10'?23:24)*3600000,gap:false,capabilityRevision:'fixture'}
    };
    const states:Settings={muted:learningOperations.filter(op=>op.id!=='W03').map(op=>op.id),opened:true};
    assert.equal(recordsReadModel(records,states,'2024-03-16').comparison.hasMissingCoverage,false);
    delete records.coverage['2024-03-10'];
    assert.equal(recordsReadModel(records,states,'2024-03-16').comparison.hasMissingCoverage,true);
  } finally { if(originalTZ===undefined) delete process.env.TZ;else process.env.TZ=originalTZ; }
});

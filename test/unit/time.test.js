const test = require('node:test');
const assert = require('node:assert');
const T = require('../../src/services/time');
const { ValidationError } = require('../../src/errors');

const now = new Date(2026, 9, 29, 10, 0);
const sched = (workDate, startTime, endTime) => T.validateSchedule({ workDate, startTime, endTime }, now);

test('parseHM', () => {
  assert.strictEqual(T.parseHM('00:00'), 0);
  assert.strictEqual(T.parseHM('23:59'), 1439);
  for (const bad of ['24:00', '25:00', '8:00', '08:60', 'ab', '', null, undefined]) {
    assert.throws(() => T.parseHM(bad), (e) => e instanceof ValidationError && e.errors[0] === 'Format tanggal/jam tidak valid.');
  }
});

test('durationMinutes', () => {
  assert.strictEqual(T.durationMinutes('22:00', '02:00'), 240);
  assert.strictEqual(T.durationMinutes('08:00', '08:00'), 0);
  assert.strictEqual(T.durationMinutes('08:00', '10:30'), 150);
});

test('toRange crosses midnight', () => {
  const r = T.toRange('2026-11-01', '22:00', '02:00');
  assert.strictEqual(r.start.getTime(), new Date(2026, 10, 1, 22, 0).getTime());
  assert.strictEqual(r.end.getTime(), new Date(2026, 10, 2, 2, 0).getTime());
  const s = T.toRange('2026-11-01', '08:00', '10:00');
  assert.strictEqual(s.end.getTime(), new Date(2026, 10, 1, 10, 0).getTime());
});

test('overlaps', () => {
  assert.strictEqual(T.overlaps(T.toRange('2026-11-01', '22:00', '02:00'), T.toRange('2026-11-02', '01:00', '03:00')), true);
  assert.strictEqual(T.overlaps(T.toRange('2026-11-01', '18:00', '20:00'), T.toRange('2026-11-01', '20:00', '22:00')), false);
});

test('date helpers', () => {
  assert.strictEqual(T.formatDate(new Date(2026, 9, 29, 23, 59)), '2026-10-29');
  assert.strictEqual(T.addDays('2026-10-29', 3), '2026-11-01');
  assert.strictEqual(T.addDays('2026-10-29', -3), '2026-10-26');
  assert.strictEqual(T.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(T.nowIso(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02T03:04:05');
});

test('weekBounds', () => {
  assert.deepStrictEqual(T.weekBounds('2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepStrictEqual(T.weekBounds('2026-11-02'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepStrictEqual(T.weekBounds('2026-10-28'), { from: '2026-10-26', to: '2026-11-01' });
});

test('validateSchedule date window', () => {
  assert.deepStrictEqual(sched('2026-10-26', '08:00', '10:00'), []);
  assert.ok(sched('2026-10-25', '08:00', '10:00').includes('Tanggal lembur paling lambat 3 hari ke belakang.'));
  assert.deepStrictEqual(sched('2026-11-28', '08:00', '10:00'), []);
  assert.ok(sched('2026-11-29', '08:00', '10:00').includes('Tanggal lembur paling jauh 30 hari ke depan.'));
});

test('validateSchedule durations', () => {
  assert.ok(sched('2026-10-29', '08:00', '08:00').includes('Jam selesai tidak boleh sama dengan jam mulai.'));
  assert.ok(sched('2026-10-29', '08:00', '08:20').includes('Durasi lembur minimal 30 menit.'));
  assert.ok(sched('2026-10-29', '06:00', '18:01').includes('Durasi lembur maksimal 12 jam.'));
  assert.deepStrictEqual(sched('2026-10-29', '06:00', '18:00'), []);
  assert.deepStrictEqual(sched('2026-10-29', '22:00', '02:00'), []);
});

test('validateSchedule format errors alone', () => {
  const f = ['Format tanggal/jam tidak valid.'];
  assert.deepStrictEqual(sched('2026-13-01', '08:00', '10:00'), f);
  assert.deepStrictEqual(sched('2026-02-30', '08:00', '10:00'), f);
  assert.deepStrictEqual(sched('2026-10-29', '25:00', '10:00'), f);
  assert.deepStrictEqual(sched('2020-01-01', '08:00', 'xx'), f);
  assert.deepStrictEqual(sched(undefined, '08:00', '10:00'), f);
});

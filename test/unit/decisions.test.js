const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const ot = require('../../src/services/overtime');
const dec = require('../../src/services/decisions');
const notifications = require('../../src/services/notifications');
const { ValidationError } = require('../../src/errors');

const NOW = new Date(2026, 9, 29, 10, 0);
const WORK = '2026-10-30';

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = (who) => users.getUser(db, ids[who]);
  const r = ot.createRequest(db, actor('budi'), {
    type: 'GROUP', workDate: WORK, startTime: '18:00', endTime: '21:00',
    activity: 'Deploy rilis versi baru', memberIds: [ids.sari],
  }, NOW);
  const pid = (who) => db.prepare('SELECT id FROM overtime_participants WHERE request_id = ? AND user_id = ?').get(r.id, ids[who]).id;
  const part = (who) => db.prepare('SELECT * FROM overtime_participants WHERE id = ?').get(pid(who));
  const reqStatus = () => db.prepare('SELECT status FROM overtime_requests WHERE id = ?').get(r.id).status;
  return { db, ids, actor, r, pid, part, reqStatus };
}

test('manager approve massal: bawahan diproses, non-bawahan dilewati', () => {
  const { db, actor, pid, part, reqStatus } = setup();
  const res = dec.decideManager(db, actor('mgrit'), [pid('budi'), pid('sari')], 'APPROVE', '', NOW);
  assert.deepStrictEqual(res, { done: 1, skipped: 1 });
  assert.strictEqual(part('budi').status, 'WAITING_HR');
  assert.strictEqual(part('budi').manager_decided_at, '2026-10-29T10:00:00');
  assert.strictEqual(part('sari').status, 'WAITING_MANAGER');
  assert.strictEqual(reqStatus(), 'PROCESSING');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'participant.manager_approve'").get());
});

test('baris yang sudah diproses dilewati, status tidak tertimpa (Review Focus #2)', () => {
  const { db, actor, pid, part } = setup();
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW);
  const res = dec.decideManager(db, actor('smit'), [pid('budi'), pid('budi'), 'x', 99999], 'REJECT', 'Tidak', NOW);
  assert.deepStrictEqual(res, { done: 0, skipped: 3 });
  assert.strictEqual(part('budi').status, 'WAITING_HR');
  assert.strictEqual(part('budi').manager_decided_by, actor('mgrit').id);
});

test('atasan lebih tinggi di rantai bisa memutuskan (Review Focus #3)', () => {
  const { db, actor, pid, part } = setup();
  const res = dec.decideManager(db, actor('smit'), [pid('budi')], 'APPROVE', '', NOW);
  assert.deepStrictEqual(res, { done: 1, skipped: 0 });
  assert.strictEqual(part('budi').status, 'WAITING_HR');
  assert.strictEqual(part('budi').manager_decided_by, actor('smit').id);
});

test('REJECT tanpa catatan ditolak', () => {
  const { db, actor, pid, part } = setup();
  assert.throws(() => dec.decideManager(db, actor('mgrit'), [pid('budi')], 'REJECT', '   ', NOW),
    (e) => e instanceof ValidationError && e.errors[0] === 'Catatan wajib diisi saat menolak.');
  assert.strictEqual(part('budi').status, 'WAITING_MANAGER');
});

test('manager tolak: status REJECTED, notifikasi ke peserta dan pengaju', () => {
  const { db, ids, actor, r, pid, part } = setup();
  const res = dec.decideManager(db, actor('mgrfin'), [pid('sari')], 'REJECT', 'Tidak mendesak', NOW);
  assert.deepStrictEqual(res, { done: 1, skipped: 0 });
  assert.strictEqual(part('sari').status, 'REJECTED');
  assert.strictEqual(part('sari').manager_note, 'Tidak mendesak');
  for (const who of ['sari', 'budi']) {
    const msgs = notifications.listNotifications(db, ids[who], 1).rows;
    const hit = msgs.filter((n) => n.message === `Lembur ${r.code} ditolak manager: Tidak mendesak`);
    assert.strictEqual(hit.length, 1, who);
    assert.strictEqual(hit[0].link, `/pengajuan/${r.id}`);
    assert.strictEqual(hit[0].created_at, '2026-10-29T10:00:00');
  }
});

test('HR: satu disetujui satu ditolak -> request APPROVED; peserta HR sendiri dilewati', () => {
  const { db, actor, pid, part, reqStatus } = setup();
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW);
  dec.decideManager(db, actor('mgrfin'), [pid('sari')], 'APPROVE', '', NOW);
  assert.deepStrictEqual(dec.decideHr(db, actor('hr'), [pid('budi')], 'APPROVE', '', NOW), { done: 1, skipped: 0 });
  assert.strictEqual(reqStatus(), 'PROCESSING');
  assert.deepStrictEqual(dec.decideHr(db, actor('hr'), [pid('sari')], 'REJECT', 'Anggaran', NOW), { done: 1, skipped: 0 });
  assert.strictEqual(part('budi').status, 'APPROVED');
  assert.strictEqual(part('sari').hr_note, 'Anggaran');
  assert.strictEqual(reqStatus(), 'APPROVED');

  const own = ot.createRequest(db, actor('hr'), { type: 'PERSONAL', workDate: '2026-11-02', startTime: '18:00', endTime: '20:00', activity: 'Rekap payroll bulanan' }, NOW);
  const ownPid = db.prepare('SELECT id FROM overtime_participants WHERE request_id = ?').get(own.id).id;
  db.prepare("UPDATE overtime_participants SET status = 'WAITING_HR' WHERE id = ?").run(ownPid);
  assert.deepStrictEqual(dec.decideHr(db, actor('hr'), [ownPid], 'APPROVE', '', NOW), { done: 0, skipped: 1 });
});

test('HR tidak bisa memutuskan peserta yang masih WAITING_MANAGER; pengaju batal dilewati', () => {
  const { db, actor, r, pid } = setup();
  assert.deepStrictEqual(dec.decideHr(db, actor('hr'), [pid('budi')], 'APPROVE', '', NOW), { done: 0, skipped: 1 });
  ot.cancelRequest(db, actor('budi'), r.id);
  assert.deepStrictEqual(dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW), { done: 0, skipped: 1 });
});

function approveBudi(ctx) {
  dec.decideManager(ctx.db, ctx.actor('mgrit'), [ctx.pid('budi')], 'APPROVE', '', NOW);
  dec.decideHr(ctx.db, ctx.actor('hr'), [ctx.pid('budi')], 'APPROVE', '', NOW);
}
const real = { actualStart: '18:00', actualEnd: '20:30' };

test('realisasi: sebelum mulai ditolak, valid tersimpan, terkunci setelah 7 hari', () => {
  const ctx = setup();
  const { db, actor, pid, part } = ctx;
  assert.throws(() => ot.saveRealization(db, actor('budi'), pid('sari'), real, new Date(2026, 9, 30, 19, 0)),
    (e) => e.errors[0] === 'Realisasi hanya untuk peserta yang disetujui.');
  approveBudi(ctx);
  assert.throws(() => ot.saveRealization(db, actor('budi'), pid('budi'), real, new Date(2026, 9, 30, 17, 59)),
    (e) => e.errors[0] === 'Realisasi bisa diisi setelah lembur dimulai.');
  assert.throws(() => ot.saveRealization(db, actor('budi'), pid('budi'), real, new Date(2026, 10, 7, 9, 0)),
    (e) => e.errors[0] === 'Realisasi sudah terkunci (lewat 7 hari).');
  assert.throws(() => ot.saveRealization(db, actor('budi'), pid('budi'), { actualStart: '18:00', actualEnd: '18:00' }, new Date(2026, 9, 30, 19, 0)),
    ValidationError);
  assert.throws(() => ot.saveRealization(db, actor('budi'), pid('budi'), { actualStart: '06:00', actualEnd: '19:30' }, new Date(2026, 9, 30, 19, 0)),
    ValidationError);
  ot.saveRealization(db, actor('budi'), pid('budi'), real, new Date(2026, 9, 30, 21, 0));
  const p = part('budi');
  assert.strictEqual(p.actual_start, '18:00');
  assert.strictEqual(p.actual_end, '20:30');
  assert.strictEqual(p.realized_at, '2026-10-30T21:00:00');
  // hari ke-7 masih boleh (pengaju = budi juga peserta; ubah ulang)
  ot.saveRealization(db, actor('budi'), pid('budi'), real, new Date(2026, 10, 6, 23, 59));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'participant.realize'").get());
});

test('realisasi: pengaju boleh untuk peserta lain, orang lain tidak', () => {
  const ctx = setup();
  const { db, actor, pid } = ctx;
  dec.decideManager(db, actor('mgrfin'), [pid('sari')], 'APPROVE', '', NOW);
  dec.decideHr(db, actor('hr'), [pid('sari')], 'APPROVE', '', NOW);
  ot.saveRealization(db, actor('budi'), pid('sari'), real, new Date(2026, 9, 30, 21, 0));
  assert.throws(() => ot.saveRealization(db, actor('andi'), pid('sari'), real, new Date(2026, 9, 30, 21, 0)),
    (e) => e.name === 'ForbiddenError' || e.constructor.name === 'ForbiddenError');
});

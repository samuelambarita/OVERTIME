const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const ot = require('../../src/services/overtime');
const notifications = require('../../src/services/notifications');
const { ValidationError, ForbiddenError } = require('../../src/errors');

const NOW = new Date(2026, 9, 29, 10, 0);
function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = (who) => users.getUser(db, ids[who]);
  return { db, ids, actor };
}
const base = { type: 'PERSONAL', workDate: '2026-10-30', startTime: '18:00', endTime: '21:00', activity: 'Deploy rilis versi baru' };
const parts = (db, id) => db.prepare('SELECT * FROM overtime_participants WHERE request_id = ? ORDER BY id').all(id);
const msgOf = (fn) => { try { fn(); } catch (e) { return e.errors || [e.message]; } return null; };
const setActiveOff = (db, id) => db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);

test('PERSONAL: kode, peserta, approver, rantai, notifikasi', () => {
  const { db, ids, actor } = setup();
  const r = ot.createRequest(db, actor('budi'), base, NOW);
  assert.strictEqual(r.code, 'LBR-2026-0001');
  const p = parts(db, r.id);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].status, 'WAITING_MANAGER');
  assert.strictEqual(p[0].manager_approver_id, ids.mgrit);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM participant_chain WHERE participant_id = ?').get(p[0].id).c, 5);
  assert.strictEqual(notifications.unreadCount(db, ids.mgrit), 1);
  const nt = notifications.listNotifications(db, ids.mgrit, 1).rows[0];
  assert.strictEqual(nt.message, 'Pengajuan lembur LBR-2026-0001 menunggu persetujuan Anda.');
  assert.strictEqual(nt.link, '/persetujuan');
  assert.strictEqual(db.prepare('SELECT status FROM overtime_requests WHERE id = ?').get(r.id).status, 'PROCESSING');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'request.create'").get());
});

test('kode berikutnya LBR-2026-0002', () => {
  const { db, actor } = setup();
  ot.createRequest(db, actor('budi'), base, NOW);
  const r2 = ot.createRequest(db, actor('andi'), base, NOW);
  assert.strictEqual(r2.code, 'LBR-2026-0002');
});

test('GROUP: dedupe, approver per peserta, notifikasi ajakan', () => {
  const { db, ids, actor } = setup();
  const r = ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: [ids.budi, ids.sari, ids.sari] }, NOW);
  const p = parts(db, r.id);
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p.find((x) => x.user_id === ids.budi).manager_approver_id, ids.mgrit);
  assert.strictEqual(p.find((x) => x.user_id === ids.sari).manager_approver_id, ids.mgrfin);
  const sn = notifications.listNotifications(db, ids.sari, 1).rows.filter((x) => x.link !== '/persetujuan');
  assert.strictEqual(sn.length, 1);
  assert.strictEqual(sn[0].message, `Budi mengajak Anda lembur (${r.code}).`);
  assert.strictEqual(sn[0].link, `/pengajuan/${r.id}`);
  assert.strictEqual(notifications.unreadCount(db, ids.budi), 0);
});

test('GROUP: approver yang sama dinotifikasi sekali', () => {
  const { db, ids, actor } = setup();
  ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: [ids.andi] }, NOW);
  assert.strictEqual(notifications.unreadCount(db, ids.mgrit), 1);
});

test('GROUP: validasi peserta', () => {
  const { db, ids, actor } = setup();
  assert.deepStrictEqual(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: [] }, NOW)),
    ['Pengajuan kelompok minimal 2 peserta.']);
  setActiveOff(db, ids.sari);
  assert.deepStrictEqual(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: [ids.sari] }, NOW)),
    ['Peserta tidak valid.']);
  assert.deepStrictEqual(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: [9999] }, NOW)),
    ['Peserta tidak valid.']);
});

test('GROUP: maksimal 50 peserta', () => {
  const { db, actor } = setup();
  const many = Array.from({ length: 60 }, (_, i) => 1000 + i);
  assert.deepStrictEqual(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, type: 'GROUP', memberIds: many }, NOW)),
    ['Pengajuan kelompok maksimal 50 peserta.']);
});

test('validasi input: kegiatan, tipe, jadwal', () => {
  const { db, actor } = setup();
  assert.deepStrictEqual(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, activity: '  pendek ' }, NOW)),
    ['Kegiatan wajib diisi (10–2000 karakter).']);
  assert.ok(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, type: 'X' }, NOW)));
  assert.ok(msgOf(() => ot.createRequest(db, actor('budi'), { ...base, workDate: '2027-01-01' }, NOW)));
});

test('presdir: peserta langsung WAITING_HR, audit skip_manager, tanpa notifikasi', () => {
  const { db, actor } = setup();
  const r = ot.createRequest(db, actor('presdir'), base, NOW);
  const p = parts(db, r.id)[0];
  assert.strictEqual(p.status, 'WAITING_HR');
  assert.strictEqual(p.manager_approver_id, null);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'participant.skip_manager'").get());
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0);
  assert.strictEqual(db.prepare('SELECT status FROM overtime_requests WHERE id = ?').get(r.id).status, 'PROCESSING');
});

test('bentrok lewat tengah malam; CANCELLED tidak dihitung', () => {
  const { db, actor } = setup();
  const a = { ...base, workDate: '2026-11-01', startTime: '22:00', endTime: '02:00' };
  const first = ot.createRequest(db, actor('budi'), a, NOW);
  const b = { ...base, workDate: '2026-11-02', startTime: '01:00', endTime: '03:00' };
  const err = msgOf(() => ot.createRequest(db, actor('budi'), b, NOW));
  assert.deepStrictEqual(err, ['Jadwal bentrok dengan lembur lain: Budi.']);
  ot.cancelRequest(db, actor('budi'), first.id);
  assert.doesNotThrow(() => ot.createRequest(db, actor('budi'), b, NOW));
  // tepat bersambung tidak bentrok
  assert.doesNotThrow(() => ot.createRequest(db, actor('budi'), { ...b, startTime: '03:00', endTime: '04:00' }, NOW));
});

test('checkWarnings: harian dan mingguan', () => {
  const { db, ids, actor } = setup();
  ot.createRequest(db, actor('budi'), { ...base, startTime: '18:00', endTime: '21:00' }, NOW);
  const w = ot.checkWarnings(db, [ids.budi], { workDate: '2026-10-30', startTime: '21:00', endTime: '23:00' });
  assert.ok(w.includes('Budi: total 5 jam pada 2026-10-30 (batas 4 jam/hari)'));
  const w2 = ot.checkWarnings(db, [ids.budi], { workDate: '2026-10-30', startTime: '21:00', endTime: '21:30' });
  assert.deepStrictEqual(w2, []);
  // minggu 2026-10-26..2026-11-01: 3 jam (30 Okt) + 4 x 4 jam = 19 jam
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) {
    ot.createRequest(db, actor('budi'), { ...base, workDate: d, startTime: '08:00', endTime: '12:00' }, new Date(2026, 9, 27, 10, 0));
  }
  const w3 = ot.checkWarnings(db, [ids.budi], { workDate: '2026-11-01', startTime: '08:00', endTime: '08:30' });
  assert.deepStrictEqual(w3, ['Budi: total 19,5 jam pada minggu 2026-10-26 s.d. 2026-11-01 (batas 18 jam/minggu)']);
});

test('checkWarnings: pakai realisasi bila ada, dan excludeRequestId', () => {
  const { db, ids, actor } = setup();
  const r = ot.createRequest(db, actor('budi'), base, NOW);
  db.prepare("UPDATE overtime_participants SET actual_start='18:00', actual_end='19:00' WHERE request_id = ?").run(r.id);
  const slot = { workDate: '2026-10-30', startTime: '20:00', endTime: '23:30' };
  assert.deepStrictEqual(ot.checkWarnings(db, [ids.budi], slot), ['Budi: total 4,5 jam pada 2026-10-30 (batas 4 jam/hari)']);
  assert.deepStrictEqual(ot.checkWarnings(db, [ids.budi], slot, r.id), []);
});

test('createRequest mengembalikan warnings', () => {
  const { db, actor } = setup();
  ot.createRequest(db, actor('budi'), base, NOW);
  const r = ot.createRequest(db, actor('budi'), { ...base, startTime: '21:00', endTime: '23:00' }, NOW);
  assert.deepStrictEqual(r.warnings, ['Budi: total 5 jam pada 2026-10-30 (batas 4 jam/hari)']);
});

test('cancelRequest: non-pengaju, setelah keputusan, sebelum keputusan', () => {
  const { db, ids, actor } = setup();
  const r = ot.createRequest(db, actor('budi'), base, NOW);
  assert.throws(() => ot.cancelRequest(db, actor('sari'), r.id), ForbiddenError);
  ot.cancelRequest(db, actor('budi'), r.id);
  assert.strictEqual(db.prepare('SELECT status FROM overtime_requests WHERE id = ?').get(r.id).status, 'CANCELLED');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'request.cancel'").get());

  const r2 = ot.createRequest(db, actor('andi'), base, NOW);
  db.prepare("UPDATE overtime_participants SET manager_decided_at = '2026-10-29T11:00:00', manager_decided_by = ?, status = 'WAITING_HR' WHERE request_id = ?").run(ids.mgrit, r2.id);
  assert.throws(() => ot.cancelRequest(db, actor('andi'), r2.id), (e) => e instanceof ValidationError
    && e.errors[0] === 'Pengajuan tidak bisa dibatalkan karena sudah ada keputusan.');
});

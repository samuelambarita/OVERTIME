const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const ot = require('../../src/services/overtime');
const dec = require('../../src/services/decisions');
const q = require('../../src/services/queries');
const { ForbiddenError, NotFoundError } = require('../../src/errors');

const NOW = new Date(2026, 9, 29, 10, 0);
const WORK = '2026-10-30';

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = (who) => users.getUser(db, ids[who]);
  const r = ot.createRequest(db, actor('budi'), {
    type: 'GROUP', workDate: WORK, startTime: '18:00', endTime: '21:00',
    activity: 'Deploy rilis', memberIds: [ids.sari],
  }, NOW);
  const pid = (who, rid = r.id) => db.prepare('SELECT id FROM overtime_participants WHERE request_id = ? AND user_id = ?').get(rid, ids[who]).id;
  return { db, ids, actor, r, pid };
}

test('akses detail: pengaju, atasan di rantai, HR boleh; lain Forbidden; id tak ada NotFound', () => {
  const { db, actor, r } = setup();
  const d = q.getRequestDetail(db, actor('budi'), r.id);
  assert.strictEqual(d.request.code, r.code);
  assert.strictEqual(d.participants.length, 2);
  assert.ok(d.participants[0].department);
  assert.ok(d.timeline.some((t) => t.action === 'request.create'));
  q.getRequestDetail(db, actor('mgrit'), r.id);
  q.getRequestDetail(db, actor('hr'), r.id);
  q.getRequestDetail(db, actor('sari'), r.id);
  assert.throws(() => q.getRequestDetail(db, actor('andi'), r.id), ForbiddenError);
  assert.throws(() => q.getRequestDetail(db, actor('budi'), 999), NotFoundError);
});

test('detail memuat nama pemutus dan timeline peserta', () => {
  const { db, actor, r, pid } = setup();
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', 'ok', NOW);
  const d = q.getRequestDetail(db, actor('budi'), r.id);
  const p = d.participants.find((x) => x.username === 'budi');
  assert.strictEqual(p.manager_decided_by_name, 'Mgrit');
  assert.ok(d.timeline.some((t) => t.action === 'participant.manager_approve'));
});

test('listMyRequests: pengaju atau peserta, terbaru dulu, filter status', () => {
  const { db, ids, actor } = setup();
  ot.createRequest(db, actor('budi'), { type: 'PERSONAL', workDate: '2026-10-31', startTime: '18:00', endTime: '20:00', activity: 'Pekerjaan lain lagi' }, new Date(2026, 9, 29, 11, 0));
  const mine = q.listMyRequests(db, ids.budi, {});
  assert.strictEqual(mine.total, 2);
  assert.strictEqual(mine.rows[0].work_date, '2026-10-31');
  assert.strictEqual(q.listMyRequests(db, ids.sari, {}).total, 1);
  assert.strictEqual(q.listMyRequests(db, ids.budi, { status: 'APPROVED' }).total, 0);
});

test('listManagerQueue mine hanya peserta IT; team smit memuat budi; tidak memuat diri sendiri', () => {
  const { db, ids, actor } = setup();
  const mine = q.listManagerQueue(db, actor('mgrit'), { scope: 'mine' });
  assert.deepStrictEqual(mine.rows.map((x) => x.username), ['budi']);
  assert.ok(Array.isArray(mine.rows[0].warnings));
  const team = q.listManagerQueue(db, actor('smit'), { scope: 'team' });
  assert.ok(team.rows.some((x) => x.username === 'budi'));
  assert.ok(!team.rows.some((x) => x.username === 'sari'));
  assert.strictEqual(q.listManagerQueue(db, actor('mgrfin'), { scope: 'mine' }).rows[0].username, 'sari');
  ot.createRequest(db, actor('mgrit'), { type: 'PERSONAL', workDate: WORK, startTime: '08:00', endTime: '09:00', activity: 'Rapat manager malam' }, NOW);
  assert.ok(!q.listManagerQueue(db, actor('mgrit'), { scope: 'team' }).rows.some((x) => x.user_id === ids.mgrit));
});

test('listHrQueue: tidak memuat milik hr; filter kategori', () => {
  const { db, ids, actor, pid } = setup();
  const rq = ot.createRequest(db, actor('hr'), { type: 'PERSONAL', workDate: WORK, startTime: '08:00', endTime: '10:00', activity: 'Pekerjaan HR lembur' }, NOW);
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW);
  dec.decideManager(db, actor('mgrfin'), [pid('sari')], 'APPROVE', '', NOW);
  dec.decideManager(db, actor('direktur'), [pid('hr', rq.id)], 'APPROVE', '', NOW);
  const all = q.listHrQueue(db, actor('hr'), {});
  assert.strictEqual(all.total, 2);
  assert.ok(!all.rows.some((x) => x.user_id === ids.hr));
  assert.deepStrictEqual(q.listHrQueue(db, actor('hr'), { category: 'IT' }).rows.map((x) => x.username), ['budi']);
});

test('pendingCounts', () => {
  const { db, actor, pid } = setup();
  assert.deepStrictEqual(q.pendingCounts(db, actor('budi')), { manager: 0, hr: 0 });
  assert.deepStrictEqual(q.pendingCounts(db, actor('smit')), { manager: 1, hr: 0 });
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW);
  assert.deepStrictEqual(q.pendingCounts(db, actor('hr')), { manager: 0, hr: 1 });
});

test('request dibatalkan tidak muncul di antrean maupun hitungan', () => {
  const { db, actor, r, pid } = setup();
  ot.cancelRequest(db, actor('budi'), r.id);
  assert.strictEqual(db.prepare('SELECT status FROM overtime_participants WHERE id = ?').get(pid('budi')).status, 'WAITING_MANAGER');
  assert.strictEqual(q.listManagerQueue(db, actor('mgrit'), { scope: 'mine' }).total, 0);
  assert.strictEqual(q.listManagerQueue(db, actor('smit'), { scope: 'team' }).total, 0);
  assert.deepStrictEqual(q.pendingCounts(db, actor('smit')), { manager: 0, hr: 0 });
  db.prepare("UPDATE overtime_participants SET status = 'WAITING_HR' WHERE id = ?").run(pid('budi'));
  assert.strictEqual(q.listHrQueue(db, actor('hr'), {}).total, 0);
  assert.deepStrictEqual(q.pendingCounts(db, actor('hr')), { manager: 0, hr: 0 });
});

test('dashboardData: menit bulan ini dari APPROVED (realisasi bila ada)', () => {
  const { db, actor, pid } = setup();
  dec.decideManager(db, actor('mgrit'), [pid('budi')], 'APPROVE', '', NOW);
  dec.decideHr(db, actor('hr'), [pid('budi')], 'APPROVE', '', NOW);
  let d = q.dashboardData(db, actor('budi'), NOW);
  assert.strictEqual(d.monthMinutes, 180);
  assert.strictEqual(d.recent.length, 1);
  ot.saveRealization(db, actor('budi'), pid('budi'), { actualStart: '18:00', actualEnd: '20:30' }, new Date(2026, 9, 30, 21, 0));
  d = q.dashboardData(db, actor('budi'), NOW);
  assert.strictEqual(d.monthMinutes, 150);
  assert.strictEqual(q.dashboardData(db, actor('budi'), new Date(2026, 10, 2)).monthMinutes, 0);
  assert.deepStrictEqual(d.pending, { manager: 0, hr: 0 });
});

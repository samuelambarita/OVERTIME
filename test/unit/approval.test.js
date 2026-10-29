const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const approval = require('../../src/services/approval');

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  return { db, ids };
}
const nm = (db, ids, who) => {
  const n = approval.nearestManager(users.supervisorChain(db, ids[who]));
  return n ? n.id : null;
};

function addParticipant(db, ids, who, status, chainWho) {
  const now = '2026-10-29T08:00:00';
  const r = db.prepare(`INSERT INTO overtime_requests (code, requester_id, type, work_date, start_time, end_time, activity, status, created_at, updated_at)
    VALUES ('LMB-T' || abs(random()), ?, 'PERSONAL', '2026-10-29', '18:00', '20:00', 'x', 'PROCESSING', ?, ?)`).run(ids[who], now, now);
  const p = db.prepare('INSERT INTO overtime_participants (request_id, user_id, status) VALUES (?, ?, ?)')
    .run(r.lastInsertRowid, ids[who], status);
  const pid = Number(p.lastInsertRowid);
  for (const c of chainWho) db.prepare('INSERT INTO participant_chain (participant_id, user_id) VALUES (?, ?)').run(pid, ids[c]);
  return db.prepare('SELECT * FROM overtime_participants WHERE id = ?').get(pid);
}
const U = (db, ids, who) => users.getUser(db, ids[who]);

test('nearestManager melewati Lead, null bila tak ada', () => {
  const { db, ids } = setup();
  assert.strictEqual(nm(db, ids, 'budi'), ids.mgrit);
  assert.strictEqual(nm(db, ids, 'mgrit'), ids.smit);
  assert.strictEqual(nm(db, ids, 'hr'), ids.direktur);
  assert.strictEqual(nm(db, ids, 'presdir'), null);
});

test('nearestManager melewati manager nonaktif', () => {
  const { db, ids } = setup();
  users.setActive(db, { id: ids.admin }, ids.mgrit, false);
  assert.strictEqual(nm(db, ids, 'budi'), ids.smit);
});

test('canDecideManager', () => {
  const { db, ids } = setup();
  const p = addParticipant(db, ids, 'budi', 'WAITING_MANAGER', ['leadit', 'mgrit', 'smit']);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'mgrit'), p), true);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'smit'), p), true);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'mgrfin'), p), false);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'leadit'), p), false);
  const self = addParticipant(db, ids, 'smit', 'WAITING_MANAGER', ['smit', 'deputi']);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'smit'), self), false);
  const hrWait = addParticipant(db, ids, 'budi', 'WAITING_HR', ['mgrit', 'smit']);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'smit'), hrWait), false);
  users.setActive(db, { id: ids.admin }, ids.smit, false);
  assert.strictEqual(approval.canDecideManager(db, U(db, ids, 'smit'), p), false);
});

test('canDecideHr', () => {
  const { db, ids } = setup();
  const p = addParticipant(db, ids, 'budi', 'WAITING_HR', []);
  assert.strictEqual(approval.canDecideHr(U(db, ids, 'hr'), p), true);
  assert.strictEqual(approval.canDecideHr(U(db, ids, 'deputi'), p), true);
  assert.strictEqual(approval.canDecideHr(U(db, ids, 'smit'), p), false);
  const own = addParticipant(db, ids, 'hr', 'WAITING_HR', []);
  assert.strictEqual(approval.canDecideHr(U(db, ids, 'hr'), own), false);
  const wm = addParticipant(db, ids, 'budi', 'WAITING_MANAGER', []);
  assert.strictEqual(approval.canDecideHr(U(db, ids, 'hr'), wm), false);
});

test('computeRequestStatus', () => {
  assert.strictEqual(approval.computeRequestStatus(['APPROVED', 'WAITING_HR']), 'PROCESSING');
  assert.strictEqual(approval.computeRequestStatus(['WAITING_MANAGER']), 'PROCESSING');
  assert.strictEqual(approval.computeRequestStatus(['REJECTED', 'REJECTED']), 'REJECTED');
  assert.strictEqual(approval.computeRequestStatus(['APPROVED', 'REJECTED']), 'APPROVED');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const ot = require('../../src/services/overtime');
const dec = require('../../src/services/decisions');
const notifications = require('../../src/services/notifications');
const { recap, summarize, toCsv } = require('../../src/services/reports');

const ROOT = path.join(__dirname, '..', '..');
const NOW = new Date(2026, 9, 29, 10, 0);
const NODE = ['--disable-warning=ExperimentalWarning'];

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  return { db, ids, actor: (who) => users.getUser(db, ids[who]) };
}
const run = (code, env, cwd = ROOT) => {
  const clean = { ...process.env, ...env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete clean[k];
  return spawnSync(process.execPath, [...NODE, '-e', code], { cwd, env: clean, encoding: 'utf8' });
};

test('I1: status ALL hanya menjumlah baris APPROVED', () => {
  const { db, ids, actor } = setup();
  const mk = (start, end) => ot.createRequest(db, actor('budi'), {
    type: 'PERSONAL', workDate: '2026-10-30', startTime: start, endTime: end, activity: 'Kegiatan uji',
  }, NOW);
  const a = mk('08:00', '11:00');
  const b = mk('13:00', '16:00');
  const pid = (r) => db.prepare('SELECT id FROM overtime_participants WHERE request_id = ?').get(r.id).id;
  dec.decideManager(db, actor('mgrit'), [pid(a)], 'APPROVE', '', NOW);
  dec.decideHr(db, actor('hr'), [pid(a)], 'APPROVE', '', NOW);
  dec.decideManager(db, actor('mgrit'), [pid(b)], 'REJECT', 'tidak', NOW);
  const rows = recap(db, actor('hr'), { from: '2026-10-01', to: '2026-10-31', status: 'ALL' });
  assert.equal(rows.length, 2);
  const s = summarize(rows);
  assert.equal(s.totalMinutes, 180);
  assert.equal(s.perUser[0].minutes, 180);
  assert.equal(s.perDepartment[0].minutes, 180);
  assert.ok(ids.budi);
});

test('I2: config menetapkan TZ=Asia/Jakarta bila TZ kosong; APP_TZ dihormati', () => {
  const r = run("require('./src/config'); console.log(process.env.TZ)", { TZ: undefined, APP_TZ: undefined });
  assert.equal(r.stdout.trim(), 'Asia/Jakarta');
  const r2 = run("require('./src/config'); console.log(process.env.TZ)", { TZ: undefined, APP_TZ: 'Asia/Makassar' });
  assert.equal(r2.stdout.trim(), 'Asia/Makassar');
});

test('I3: cancelRequest memberi notifikasi peserta (bukan pengaju) dan manager sekali', () => {
  const { db, ids, actor } = setup();
  const r = ot.createRequest(db, actor('budi'), {
    type: 'GROUP', workDate: '2026-10-30', startTime: '18:00', endTime: '21:00', activity: 'Deploy rilis', memberIds: [ids.andi, ids.sari],
  }, NOW);
  const before = (u) => notifications.unreadCount(db, ids[u]);
  const b = Object.fromEntries(['budi', 'andi', 'sari', 'mgrit', 'mgrfin'].map((u) => [u, before(u)]));
  ot.cancelRequest(db, actor('budi'), r.id);
  const msg = `Pengajuan lembur ${r.code} dibatalkan oleh ${actor('budi').name}.`;
  const got = (u) => db.prepare('SELECT message, link FROM notifications WHERE user_id = ? AND message = ?').all(ids[u], msg);
  assert.equal(got('budi').length, 0);
  assert.equal(notifications.unreadCount(db, ids.budi), b.budi);
  for (const u of ['andi', 'sari', 'mgrit', 'mgrfin']) {
    assert.equal(got(u).length, 1, u);
    assert.equal(got(u)[0].link, `/pengajuan/${r.id}`);
  }
  // andi dan budi sama-sama di bawah mgrit: mgrit hanya satu notifikasi pembatalan
  assert.equal(got('mgrit').length, 1);
});

test('I4: DB_FILE relatif dihitung dari root proyek; backup menolak DB yang tidak ada', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lembur-cwd-'));
  try {
    const r = run(`console.log(require(${JSON.stringify(path.join(ROOT, 'src', 'config'))}).dbFile)`, { DB_FILE: 'data/x.db' }, tmp);
    assert.equal(r.stdout.trim(), path.join(ROOT, 'data', 'x.db'));
    const b = spawnSync(process.execPath, [...NODE, path.join(ROOT, 'src', 'db', 'backup.js')], {
      cwd: tmp, env: { ...process.env, DB_FILE: path.join(tmp, 'tidak-ada.db') }, encoding: 'utf8',
    });
    assert.equal(b.status, 1);
    assert.match(b.stderr, /tidak ditemukan/);
    assert.equal(fs.existsSync(path.join(tmp, 'tidak-ada.db')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('I5: changePassword menolak password baru yang sama', () => {
  const { db, ids } = setup();
  assert.throws(() => users.changePassword(db, ids.budi, 'Password123', 'Password123'),
    (e) => e.errors[0] === 'Password baru harus berbeda dari password lama.');
});

test('M4: csvField memberi awalan pada nilai berawalan tab atau CR', () => {
  const row = { code: 'X', workDate: '2026-10-30', name: '\tTab', username: '\rCR', department: 'D', category: 'IT', start: '08:00', end: '09:00', minutes: 60, source: 'Rencana', status: 'APPROVED', activity: 'a' };
  const csv = toCsv([row]);
  assert.ok(csv.includes("'\tTab"));
  assert.ok(csv.includes('"\'\rCR"'));
});

test('M7: busy_timeout 5000', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
});

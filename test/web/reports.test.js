const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, login } = require('../helpers');
const time = require('../../src/services/time');
const { createRequest } = require('../../src/services/overtime');
const { decideManager, decideHr } = require('../../src/services/decisions');

let app;
const today = time.formatDate(new Date());
const user = (n) => app.db.prepare('SELECT * FROM users WHERE username = ?').get(n);

before(async () => {
  app = await startApp();
  const mk = (who, activity) => createRequest(app.db, user(who), {
    type: 'PERSONAL', workDate: today, startTime: '08:00', endTime: '10:00', activity, memberIds: [],
  }, new Date());
  const rb = mk('budi', 'Kegiatan budi');
  const rs = mk('sari', 'Kegiatan sari');
  for (const [r, mgr] of [[rb, 'mgrit'], [rs, 'mgrfin']]) {
    const pid = app.db.prepare('SELECT id FROM overtime_participants WHERE request_id = ?').get(r.id).id;
    decideManager(app.db, user(mgr), [pid], 'APPROVE', '', new Date());
    decideHr(app.db, user('hr'), [pid], 'APPROVE', '', new Date());
  }
});
after(async () => { await app.close(); });

const FILE_RE = /^attachment; filename="rekap-lembur-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/;

test('budi tidak boleh membuka /rekap atau /rekap.csv (403)', async () => {
  const c = await login(app.base, 'budi');
  assert.equal((await c.get('/rekap')).status, 403);
  assert.equal((await c.get('/rekap.csv')).status, 403);
});

test('hr /rekap.csv: text/csv, attachment, BOM + header', async () => {
  const c = await login(app.base, 'hr');
  const res = await c.get('/rekap.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), FILE_RE);
  // Client memakai res.text() yang membuang BOM; periksa byte mentah.
  const raw = Buffer.from(await (await fetch(`${app.base}/rekap.csv`, { headers: { cookie: c._cookieHeader() } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(res.text.startsWith('Kode;Tanggal;Nama'));
  assert.match(res.text, /Kegiatan budi/);
});

test('tanggal tidak valid jatuh ke default dan nama file aman', async () => {
  const c = await login(app.base, 'hr');
  const res = await c.get('/rekap.csv?from=%22%0d%0aevil&to=abc');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), FILE_RE);
  assert.ok(res.headers.get('content-disposition').endsWith(`-${today}.csv"`));
});

test('mgrfin /rekap memuat sari tetapi tidak budi; filter hr bekerja', async () => {
  const c = await login(app.base, 'mgrfin');
  const res = await c.get('/rekap');
  assert.equal(res.status, 200);
  assert.match(res.text, /Sari/);
  assert.ok(!res.text.includes('Budi'));
  const h = await (await login(app.base, 'hr')).get(`/rekap?from=${today}&to=${today}&category=IT&status=ALL&departmentId=x`);
  assert.equal(h.status, 200);
  assert.match(h.text, /Budi/);
  assert.ok(!h.text.includes('Sari'));
  assert.match(h.text, /2:00|2 jam|2,0/);
});

test('M6: from > to ditukar', async () => {
  const c = await login(app.base, 'hr');
  const res = await c.get('/rekap?from=2026-10-20&to=2026-10-10');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="from" value="2026-10-10"/);
  assert.match(res.text, /name="to" value="2026-10-20"/);
});

test('I1: rekap Semua memberi label Total jam disetujui', async () => {
  const c = await login(app.base, 'hr');
  const res = await c.get('/rekap?status=ALL');
  assert.match(res.text, /Total jam disetujui/);
});

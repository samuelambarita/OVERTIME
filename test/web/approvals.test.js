const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, login } = require('../helpers');
const time = require('../../src/services/time');
const { createRequest } = require('../../src/services/overtime');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const user = (name) => app.db.prepare('SELECT * FROM users WHERE username = ?').get(name);
const day = (n) => time.addDays(time.formatDate(new Date()), n);
const mk = (who, extra = {}) => createRequest(app.db, user(who), {
  type: 'PERSONAL', workDate: day(1), startTime: '18:00', endTime: '19:00', activity: 'Kegiatan uji', memberIds: [], ...extra,
}, new Date());
const part = (reqId, who) => app.db.prepare('SELECT * FROM overtime_participants WHERE request_id = ? AND user_id = ?').get(reqId, user(who).id);

test('budi tidak boleh membuka /persetujuan (403)', async () => {
  const c = await login(app.base, 'budi');
  assert.equal((await c.get('/persetujuan')).status, 403);
});

test('mgrit melihat budi tetapi tidak sari; POST campuran -> 1 diproses, 1 dilewati', async () => {
  const rb = mk('budi', { startTime: '08:00', endTime: '09:00' });
  const rs = mk('sari', { startTime: '08:00', endTime: '09:00' });
  const c = await login(app.base, 'mgrit');
  const page = await c.get('/persetujuan');
  assert.equal(page.status, 200);
  assert.match(page.text, /Budi/);
  assert.ok(!page.text.includes('Sari'));
  const res = await c.post('/persetujuan', { ids: [part(rb.id, 'budi').id, part(rs.id, 'sari').id], decision: 'APPROVE' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/persetujuan?tab=mine');
  const after = await c.get('/persetujuan');
  assert.match(after.text, /1 diproses, 1 dilewati\./);
});

test('redirect mempertahankan query yang di-whitelist', async () => {
  const c = await login(app.base, 'mgrit');
  const res = await c.post('/persetujuan?tab=team&page=2&evil=1', { decision: 'APPROVE' });
  assert.equal(res.location, '/persetujuan?tab=team&page=2');
  const flash = await c.get(res.location);
  assert.match(flash.text, /Pilih minimal satu/);
});

test('mgrfin menolak sari tanpa catatan -> flash error, status tetap', async () => {
  const rs = mk('sari', { startTime: '11:00', endTime: '12:00' });
  const p = part(rs.id, 'sari');
  const c = await login(app.base, 'mgrfin');
  const res = await c.post('/persetujuan', { ids: [p.id], decision: 'REJECT', note: '' });
  assert.equal(res.status, 302);
  const page = await c.get('/persetujuan');
  assert.match(page.text, /Catatan wajib/);
  assert.equal(part(rs.id, 'sari').status, 'WAITING_MANAGER');
});

test('tombol per baris tidak berada dalam form bersarang; kegiatan panjang dipotong', async () => {
  const long = 'A'.repeat(130);
  const rb = mk('andi', { startTime: '14:00', endTime: '15:00', activity: long });
  const c = await login(app.base, 'mgrit');
  const page = await c.get('/persetujuan');
  const pid = part(rb.id, 'andi').id;
  assert.ok(page.text.includes(`id="row-${pid}"`));
  assert.ok(page.text.includes(`form="row-${pid}"`));
  assert.ok(page.text.includes('A'.repeat(120) + '…'));
  assert.ok(page.text.includes(`title="${long}"`));
  assert.ok(!page.text.includes('A'.repeat(121) + '<'));
  // satu bulk form saja yang membungkus tabel; form per baris di luar
  const bulk = page.text.slice(page.text.indexOf('id="bulk-form"'), page.text.indexOf('</form>', page.text.indexOf('id="bulk-form"')));
  assert.ok(!bulk.includes('<form', 10));
});

test('mgrit tidak boleh membuka /persetujuan-hr (403)', async () => {
  const c = await login(app.base, 'mgrit');
  assert.equal((await c.get('/persetujuan-hr')).status, 403);
});

test('hr melihat antrean, filter kategori, dan menyetujui -> detail Disetujui', async () => {
  const rb = mk('budi', { startTime: '16:00', endTime: '17:00' });
  const pb = part(rb.id, 'budi');
  const m = await login(app.base, 'mgrit');
  await m.post('/persetujuan', { ids: [pb.id], decision: 'APPROVE' });
  const c = await login(app.base, 'hr');
  const page = await c.get('/persetujuan-hr');
  assert.equal(page.status, 200);
  assert.match(page.text, /Budi/);
  const nonIt = await c.get('/persetujuan-hr?category=NON_IT&departmentId=abc');
  assert.ok(!nonIt.text.includes('Budi'));
  const res = await c.post('/persetujuan-hr?category=IT', { ids: [pb.id], decision: 'APPROVE' });
  assert.equal(res.location, '/persetujuan-hr?category=IT');
  const detail = await c.get(`/pengajuan/${rb.id}`);
  assert.match(detail.text, /Disetujui/);
});

test('POST /persetujuan tanpa CSRF -> 403', async () => {
  const c = await login(app.base, 'mgrit');
  const res = await c.post('/persetujuan', { ids: [1], decision: 'APPROVE', _csrf: null });
  assert.equal(res.status, 403);
});

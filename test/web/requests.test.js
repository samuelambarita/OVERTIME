const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, login } = require('../helpers');
const time = require('../../src/services/time');
const { createRequest } = require('../../src/services/overtime');
const { decideManager, decideHr } = require('../../src/services/decisions');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const user = (name) => app.db.prepare('SELECT * FROM users WHERE username = ?').get(name);
const tomorrow = () => time.addDays(time.formatDate(new Date()), 1);
const valid = (extra = {}) => ({
  type: 'PERSONAL', workDate: tomorrow(), startTime: '18:00', endTime: '20:00',
  activity: 'Menyelesaikan laporan bulanan', ...extra,
});

test('nav memuat /pengajuan/baru', async () => {
  const c = await login(app.base, 'budi');
  const res = await c.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/pengajuan\/baru"/);
});

test('budi kirim PERSONAL valid -> redirect ke detail yang memuat kode & kegiatan', async () => {
  const c = await login(app.base, 'budi');
  const res = await c.post('/pengajuan', valid());
  assert.equal(res.status, 302);
  assert.match(res.location, /^\/pengajuan\/\d+$/);
  const detail = await c.get(res.location);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /LBR-2026-/);
  assert.match(detail.text, /Menyelesaikan laporan bulanan/);
  assert.match(detail.text, /terkirim/);
});

test('kegiatan kosong -> 422 dengan pesan & tanggal tetap', async () => {
  const c = await login(app.base, 'budi');
  const d = tomorrow();
  const res = await c.post('/pengajuan', valid({ activity: '', workDate: d }));
  assert.equal(res.status, 422);
  assert.match(res.text, /Kegiatan wajib diisi/);
  assert.ok(res.text.includes(`value="${d}"`));
});

test('GROUP budi + sari -> detail memuat Sari & Menunggu Manager', async () => {
  const c = await login(app.base, 'budi');
  const res = await c.post('/pengajuan', valid({ type: 'GROUP', memberIds: [app.ids.sari], startTime: '10:00', endTime: '11:00' }));
  assert.equal(res.status, 302);
  const detail = await c.get(res.location);
  assert.match(detail.text, /Sari/);
  assert.match(detail.text, /Menunggu Manager/);
  assert.match(detail.text, /Batalkan/);
});

test('cari anggota htmx -> fragmen tanpa layout', async () => {
  const c = await login(app.base, 'budi');
  const res = await c.get('/pengajuan/cari-anggota?q=sar', { htmx: true });
  assert.equal(res.status, 200);
  assert.match(res.text, /sari/);
  assert.doesNotMatch(res.text, /<html/);
  const short = await c.get('/pengajuan/cari-anggota?q=s', { htmx: true });
  assert.doesNotMatch(short.text, /sari/);
});

test('cek peringatan mengembalikan fragmen bentrok', async () => {
  const c = await login(app.base, 'andi');
  const d = tomorrow();
  const r = createRequest(app.db, user('andi'), { type: 'PERSONAL', workDate: d, startTime: '08:00', endTime: '09:00', activity: 'Aktivitas awal pagi' });
  assert.ok(r.id);
  const res = await c.post('/pengajuan/cek', { type: 'PERSONAL', workDate: d, startTime: '08:30', endTime: '09:30' }, { htmx: true });
  assert.equal(res.status, 200);
  assert.match(res.text, /Andi/);
  assert.doesNotMatch(res.text, /<html/);
  const none = await c.post('/pengajuan/cek', { type: 'PERSONAL', workDate: d, startTime: '12:00', endTime: '13:00' }, { htmx: true });
  assert.doesNotMatch(none.text, /Andi/);
});

test('andi buka detail pengajuan budi -> 403', async () => {
  const b = await login(app.base, 'budi');
  const res = await b.post('/pengajuan', valid({ startTime: '14:00', endTime: '15:00' }));
  const a = await login(app.base, 'andi');
  assert.equal((await a.get(res.location)).status, 403);
});

test('budi batal -> status Dibatalkan', async () => {
  const b = await login(app.base, 'budi');
  const res = await b.post('/pengajuan', valid({ startTime: '15:30', endTime: '16:30' }));
  const cancel = await b.post(`${res.location}/batal`);
  assert.equal(cancel.status, 302);
  const detail = await b.get(res.location);
  assert.match(detail.text, /Dibatalkan/);
});

test('notifikasi mgrit memuat kode pengajuan', async () => {
  const b = await login(app.base, 'budi');
  const res = await b.post('/pengajuan', valid({ startTime: '16:30', endTime: '17:30' }));
  const code = /LBR-\d{4}-\d+/.exec((await b.get(res.location)).text)[0];
  const m = await login(app.base, 'mgrit');
  const n = await m.get('/notifikasi');
  assert.equal(n.status, 200);
  assert.ok(n.text.includes(code));
  const all = await m.post('/notifikasi/baca-semua');
  assert.equal(all.status, 302);
});

test('kegiatan di-escape', async () => {
  const b = await login(app.base, 'budi');
  const res = await b.post('/pengajuan', valid({ activity: '<script>alert(1)</script>', startTime: '21:00', endTime: '22:00' }));
  const detail = await b.get(res.location);
  assert.match(detail.text, /&lt;script&gt;/);
  assert.doesNotMatch(detail.text, /<script>alert/);
});

test('daftar pengajuan saya memuat pengajuan', async () => {
  const b = await login(app.base, 'budi');
  const res = await b.get('/pengajuan?status=PROCESSING');
  assert.equal(res.status, 200);
  assert.match(res.text, /LBR-/);
});

test('realisasi peserta APPROVED lalu tampil di detail', async () => {
  const now = new Date(Date.now() - 3 * 86400000);
  const d = time.formatDate(new Date(Date.now() - 86400000));
  const budi = user('budi');
  const r = createRequest(app.db, budi, { type: 'PERSONAL', workDate: d, startTime: '00:00', endTime: '01:00', activity: 'Pemeliharaan server malam' }, now);
  const pid = app.db.prepare('SELECT id FROM overtime_participants WHERE request_id = ?').get(r.id).id;
  decideManager(app.db, user('mgrit'), [pid], 'APPROVE', '', now);
  decideHr(app.db, user('hr'), [pid], 'APPROVE', '', now);
  const b = await login(app.base, 'budi');
  const detail = await b.get(`/pengajuan/${r.id}`);
  assert.match(detail.text, /realisasi/i);
  const res = await b.post(`/pengajuan/peserta/${pid}/realisasi`, { actualStart: '00:00', actualEnd: '01:30' });
  assert.equal(res.status, 302);
  assert.equal(res.location, `/pengajuan/${r.id}`);
  const after2 = await b.get(res.location);
  assert.match(after2.text, /Realisasi disimpan/);
  assert.match(after2.text, /1,5/);
});

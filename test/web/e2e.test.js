const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, login } = require('../helpers');
const { formatDate, addDays } = require('../../src/services/time');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

test('alur penuh: ajukan -> manager -> HR -> realisasi -> rekap CSV', async () => {
  const { db, ids } = app;
  const yesterday = addDays(formatDate(new Date()), -1);
  const pid = (userId) => db.prepare('SELECT id FROM overtime_participants WHERE user_id = ?').get(userId).id;

  // budi mengajukan lembur kelompok kemarin 18:00-21:00
  const budi = await login(app.base, 'budi');
  const create = await budi.post('/pengajuan', {
    type: 'GROUP', workDate: yesterday, startTime: '18:00', endTime: '21:00',
    activity: 'Rilis mingguan', memberIds: [ids.andi, ids.sari],
  });
  assert.equal(create.status, 302);
  const detailUrl = create.location;
  assert.match(detailUrl, /^\/pengajuan\/\d+$/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM overtime_participants').get().c, 3);

  // mgrit menyetujui budi + andi secara massal
  const mgrit = await login(app.base, 'mgrit');
  const q = await mgrit.get('/persetujuan');
  assert.equal(q.status, 200);
  const r1 = await mgrit.post('/persetujuan', { ids: [pid(ids.budi), pid(ids.andi)], decision: 'APPROVE' });
  assert.equal(r1.status, 302);

  // mgrfin menolak sari dengan catatan
  const mgrfin = await login(app.base, 'mgrfin');
  const r2 = await mgrfin.post('/persetujuan', { ids: [pid(ids.sari)], decision: 'REJECT', note: 'Tidak mendesak' });
  assert.equal(r2.status, 302);

  // HR menyetujui yang tersisa di antrean
  const hr = await login(app.base, 'hr');
  const hrPage = await hr.get('/persetujuan-hr');
  assert.equal(hrPage.status, 200);
  const r3 = await hr.post('/persetujuan-hr', { ids: [pid(ids.budi), pid(ids.andi)], decision: 'APPROVE' });
  assert.equal(r3.status, 302);

  // detail: status akhir
  const detail = await budi.get(detailUrl);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Disetujui/);
  assert.match(detail.text, /Ditolak/);
  assert.equal(db.prepare('SELECT status FROM overtime_participants WHERE user_id = ?').get(ids.sari).status, 'REJECTED');
  assert.equal(db.prepare('SELECT status FROM overtime_participants WHERE user_id = ?').get(ids.budi).status, 'APPROVED');

  // budi mengisi realisasi 18:00-20:30
  const r4 = await budi.post(`/pengajuan/peserta/${pid(ids.budi)}/realisasi`, { actualStart: '18:00', actualEnd: '20:30' });
  assert.equal(r4.status, 302);
  assert.equal(r4.location, detailUrl);

  // rekap CSV HR memuat baris budi 2,50 Realisasi
  const csv = await hr.get(`/rekap.csv?from=${yesterday}&to=${yesterday}`);
  assert.equal(csv.status, 200);
  const line = csv.text.split('\r\n').find((l) => l.includes(';budi;'));
  assert.ok(line, csv.text);
  assert.match(line, /;2,50;Realisasi;/);
  assert.ok(!csv.text.includes(';sari;'));
});

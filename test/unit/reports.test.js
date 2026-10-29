const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');
const ot = require('../../src/services/overtime');
const dec = require('../../src/services/decisions');
const { recap, summarize, toCsv } = require('../../src/services/reports');
const { ForbiddenError } = require('../../src/errors');

const NOW = new Date(2026, 9, 29, 10, 0);
const WORK = '2026-10-30';
const HEADER = 'Kode;Tanggal;Nama;Username;Departemen;Kategori;Mulai;Selesai;Durasi (jam);Sumber;Status;Kegiatan';

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = (who) => users.getUser(db, ids[who]);
  const r = ot.createRequest(db, actor('budi'), {
    type: 'GROUP', workDate: WORK, startTime: '18:00', endTime: '21:00',
    activity: 'Deploy rilis', memberIds: [ids.sari],
  }, NOW);
  const pid = (who) => db.prepare('SELECT id FROM overtime_participants WHERE request_id = ? AND user_id = ?').get(r.id, ids[who]).id;
  const approve = (who, mgr) => {
    dec.decideManager(db, actor(mgr), [pid(who)], 'APPROVE', '', NOW);
    dec.decideHr(db, actor('hr'), [pid(who)], 'APPROVE', '', NOW);
  };
  return { db, ids, actor, r, pid, approve };
}

test('recap: cakupan per jabatan dan default APPROVED', () => {
  const { db, actor, approve } = setup();
  approve('budi', 'mgrit');
  approve('sari', 'mgrfin');
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.deepStrictEqual(recap(db, actor('hr'), range).map((x) => x.username).sort(), ['budi', 'sari']);
  const fin = recap(db, actor('mgrfin'), range);
  assert.deepStrictEqual(fin.map((x) => x.username), ['sari']);
  assert.strictEqual(fin[0].activity, 'Deploy rilis');
  assert.throws(() => recap(db, actor('budi'), range), ForbiddenError);
  assert.deepStrictEqual(recap(db, actor('hr'), { ...range, category: 'IT' }).map((x) => x.username), ['budi']);
});

test('recap: filter status peserta, ALL/kosong = semua', () => {
  const { db, actor, approve } = setup();
  approve('budi', 'mgrit');
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.strictEqual(recap(db, actor('hr'), { ...range, status: 'WAITING_MANAGER' }).length, 1);
  assert.strictEqual(recap(db, actor('hr'), { ...range, status: 'ALL' }).length, 2);
  assert.strictEqual(recap(db, actor('hr'), { ...range, status: '' }).length, 2);
});

test('recap: realisasi dipakai bila ada', () => {
  const { db, actor, pid, approve } = setup();
  approve('budi', 'mgrit');
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.strictEqual(recap(db, actor('hr'), range)[0].source, 'Rencana');
  ot.saveRealization(db, actor('budi'), pid('budi'), { actualStart: '18:00', actualEnd: '20:30' }, new Date(2026, 9, 30, 21, 0));
  const [row] = recap(db, actor('hr'), range);
  assert.strictEqual(row.source, 'Realisasi');
  assert.strictEqual(row.minutes, 150);
  assert.strictEqual(row.start, '18:00');
  assert.strictEqual(row.end, '20:30');
});

test('summarize: total dan urut menurun', () => {
  const rows = [
    { name: 'A', username: 'a', department: 'IT', category: 'IT', minutes: 60, status: 'APPROVED' },
    { name: 'B', username: 'b', department: 'Finance', category: 'NON_IT', minutes: 180, status: 'APPROVED' },
    { name: 'A', username: 'a', department: 'IT', category: 'IT', minutes: 30, status: 'APPROVED' },
  ];
  const s = summarize(rows);
  assert.strictEqual(s.totalMinutes, 270);
  assert.deepStrictEqual(s.perUser, [{ name: 'B', department: 'Finance', minutes: 180 }, { name: 'A', department: 'IT', minutes: 90 }]);
  assert.deepStrictEqual(s.perDepartment.map((d) => [d.department, d.category, d.minutes]), [['Finance', 'NON_IT', 180], ['IT', 'IT', 90]]);
});

const base = { code: 'LMB-1', workDate: WORK, name: 'Budi', username: 'budi', department: 'IT', category: 'IT', start: '18:00', end: '20:30', minutes: 150, source: 'Rencana', status: 'APPROVED', activity: 'x' };

test('toCsv: BOM, header, durasi koma, label Indonesia', () => {
  const csv = toCsv([base, { ...base, category: 'NON_IT', status: 'WAITING_MANAGER' }]);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], HEADER);
  assert.strictEqual(lines[1], `LMB-1;${WORK};Budi;budi;IT;IT;18:00;20:30;2,50;Rencana;Disetujui;x`);
  assert.ok(lines[2].includes(';Non-IT;') && lines[2].endsWith(';Menunggu Manager;x'));
});

test('toCsv: kutip dan prefiks anti injeksi formula (Review Focus #5)', () => {
  const csv = toCsv([
    { ...base, activity: 'Deploy; "hotfix"\nmalam' },
    { ...base, activity: '-rollback' },
    { ...base, name: '=SUM(A1)' },
    { ...base, activity: '@cmd' },
  ]);
  assert.ok(csv.includes('"Deploy; ""hotfix""\nmalam"'));
  assert.ok(csv.endsWith("Disetujui;'@cmd"));
  assert.ok(csv.includes("Disetujui;'-rollback"));
  assert.ok(csv.includes(";'=SUM(A1);budi;"));
});

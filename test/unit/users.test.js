const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const users = require('../../src/services/users');

function setup() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const actor = { id: ids.admin };
  return { db, ids, actor };
}
const base = (ids, o = {}) => ({ username: 'Baru', password: 'Password123', name: 'Baru', level: 1, departmentId: 1, supervisorId: ids.leadit, ...o });
const msg = (fn) => { try { fn(); } catch (e) { return e.errors; } return null; };

test('createUser valid: lowercase, must_change_password, authenticate', () => {
  const { db, ids, actor } = setup();
  const before = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
  const { id, warnings } = users.createUser(db, actor, base(ids, { username: 'Budi2' }));
  const u = users.getUser(db, id);
  assert.strictEqual(u.username, 'budi2');
  assert.strictEqual(u.must_change_password, 1);
  assert.strictEqual(u.password_hash, undefined);
  assert.deepStrictEqual(warnings, []);
  assert.ok(users.authenticate(db, 'BUDI2', 'Password123'));
  assert.strictEqual(users.authenticate(db, 'budi2', 'salah'), null);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM audit_log').get().c > before);
});

test('duplikat username beda case ditolak; NIK duplikat; password pendek', () => {
  const { db, ids, actor } = setup();
  assert.deepStrictEqual(msg(() => users.createUser(db, actor, base(ids, { username: 'BUDI' }))), ['Username sudah dipakai.']);
  users.createUser(db, actor, base(ids, { nik: '123' }));
  assert.deepStrictEqual(msg(() => users.createUser(db, actor, base(ids, { username: 'lain', nik: '123' }))), ['NIK sudah dipakai.']);
  assert.deepStrictEqual(msg(() => users.createUser(db, actor, base(ids, { username: 'lain', password: 'pendek' }))), ['Password minimal 8 karakter.']);
  assert.ok(users.validateUsername('A!'));
  assert.strictEqual(users.validateUsername('ok.user_1'), null);
});

test('atasan: wajib kecuali Presdir, bukan diri sendiri', () => {
  const { db, ids, actor } = setup();
  assert.deepStrictEqual(msg(() => users.createUser(db, actor, base(ids, { supervisorId: null }))), ['Atasan wajib diisi kecuali Presdir.']);
  const r = users.createUser(db, actor, base(ids, { username: 'presdir2', level: 8, supervisorId: null }));
  assert.ok(r.id);
  assert.deepStrictEqual(msg(() => users.updateUser(db, actor, ids.budi, { supervisorId: ids.budi })), ['Atasan tidak boleh diri sendiri.']);
});

test('siklus atasan ditolak; warning jabatan atasan lebih rendah', () => {
  const { db, ids, actor } = setup();
  assert.deepStrictEqual(msg(() => users.updateUser(db, actor, ids.mgrit, { supervisorId: ids.budi })), ['Atasan membentuk siklus.']);
  const r = users.updateUser(db, actor, ids.leadit, { supervisorId: ids.sari });
  assert.deepStrictEqual(r.warnings, ['Jabatan atasan lebih rendah dari bawahan.']);
});

test('updateUser mengubah field dan menulis audit', () => {
  const { db, ids, actor } = setup();
  users.updateUser(db, actor, ids.budi, { name: 'Budi Baru', level: 2 });
  const u = users.getUser(db, ids.budi);
  assert.strictEqual(u.name, 'Budi Baru');
  assert.strictEqual(u.level, 2);
  assert.strictEqual(u.supervisor_id, ids.leadit);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='user.update'").get());
});

test('supervisorChain', () => {
  const { db, ids } = setup();
  assert.deepStrictEqual(users.supervisorChain(db, ids.budi).map(u => u.username), ['leadit', 'mgrit', 'smit', 'direktur', 'presdir']);
});

test('setActive: admin terakhir, subordinates, authenticate nonaktif', () => {
  const { db, ids, actor } = setup();
  assert.deepStrictEqual(msg(() => users.setActive(db, actor, ids.admin, false)), ['Minimal harus ada satu admin aktif.']);
  assert.deepStrictEqual(users.setActive(db, actor, ids.mgrit, false), { subordinates: 2 });
  assert.strictEqual(users.authenticate(db, 'mgrit', 'Password123'), null);
  users.setActive(db, actor, ids.mgrit, true);
  assert.ok(users.authenticate(db, 'mgrit', 'Password123'));
});

test('resetPassword dan changePassword', () => {
  const { db, ids, actor } = setup();
  users.resetPassword(db, actor, ids.budi, 'Baru12345');
  assert.strictEqual(users.getUser(db, ids.budi).must_change_password, 1);
  assert.ok(users.authenticate(db, 'budi', 'Baru12345'));
  assert.deepStrictEqual(msg(() => users.changePassword(db, ids.budi, 'salah', 'Lainnya123')), ['Password lama salah.']);
  assert.deepStrictEqual(msg(() => users.changePassword(db, ids.budi, 'Baru12345', 'pendek')), ['Password minimal 8 karakter.']);
  users.changePassword(db, ids.budi, 'Baru12345', 'Lainnya123');
  assert.strictEqual(users.getUser(db, ids.budi).must_change_password, 0);
  assert.ok(users.authenticate(db, 'budi', 'Lainnya123'));
});

test('listUsers dan searchUsers', () => {
  const { db, ids } = setup();
  const all = users.listUsers(db, {});
  assert.strictEqual(all.total, 12);
  assert.strictEqual(users.listUsers(db, { q: 'bud' }).total, 1);
  const s = users.searchUsers(db, 'an');
  assert.ok(s.some(x => x.username === 'andi' && x.department === 'IT'));
  users.setActive(db, { id: ids.admin }, ids.andi, false);
  assert.ok(!users.searchUsers(db, 'andi').length);
});

test('listUsers tahan page non-integer/besar; updateUser abaikan undefined', () => {
  const { db, ids, actor } = setup();
  assert.strictEqual(users.listUsers(db, { page: '1.5' }).rows.length, 12);
  assert.doesNotThrow(() => users.listUsers(db, { page: '1e30' }));
  users.updateUser(db, actor, ids.budi, { name: 'Budi X', level: undefined, supervisorId: undefined });
  const u = users.getUser(db, ids.budi);
  assert.strictEqual(u.level, 1);
  assert.strictEqual(u.supervisor_id, ids.leadit);
});

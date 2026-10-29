const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { openDb } = require('../../src/db');
const { seed } = require('../../src/db/seed');
const { backup } = require('../../src/db/backup');

test('seed membuat departemen Umum dan admin dengan must_change_password', () => {
  const db = openDb(':memory:');
  const r = seed(db, { username: 'Admin', password: 'RahasiaBanget1' });
  assert.equal(r.skipped, false);
  assert.match(r.messages[0], /^Admin dibuat: admin /);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  assert.equal(u.level, 1);
  assert.equal(u.is_admin, 1);
  assert.equal(u.must_change_password, 1);
  assert.equal(u.supervisor_id, null);
  assert.ok(bcrypt.compareSync('RahasiaBanget1', u.password_hash));
  assert.equal(db.prepare("SELECT category FROM departments WHERE name = 'Umum'").get().category, 'NON_IT');
  const a = db.prepare("SELECT * FROM audit_log WHERE action = 'user.create'").get();
  assert.equal(a.actor_id, null);
  assert.ok(!r.messages.join('\n').includes('RahasiaBanget1'));
});

test('seed kedua kali dilewati (idempoten)', () => {
  const db = openDb(':memory:');
  seed(db, { username: 'admin', password: 'RahasiaBanget1' });
  const r = seed(db, { username: 'admin2', password: 'RahasiaBanget1' });
  assert.equal(r.skipped, true);
  assert.deepEqual(r.messages, ['Admin sudah ada, dilewati.']);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM departments').get().c, 1);
});

test('seed menolak password pendek / kosong', () => {
  const db = openDb(':memory:');
  assert.throws(() => seed(db, { username: 'admin', password: 'pendek' }), /minimal 8/);
  assert.throws(() => seed(db, { username: 'admin' }), /minimal 8/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
});

test('--demo hanya bila tabel users kosong', () => {
  const db = openDb(':memory:');
  const r = seed(db, { demo: true });
  assert.equal(r.skipped, false);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM users').get().c > 5);
  assert.match(r.messages.join('\n'), /budi/);
  assert.match(r.messages.join('\n'), /Password123/);
  const r2 = seed(db, { demo: true });
  assert.match(r2.messages.join('\n'), /demo dilewati/i);

  const db2 = openDb(':memory:');
  seed(db2, { username: 'admin', password: 'RahasiaBanget1' });
  const r3 = seed(db2, { demo: true });
  assert.match(r3.messages.join('\n'), /demo dilewati/i);
  assert.equal(db2.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
});

test('backup menulis lembur-YYYYMMDD-HHMMSS.db yang bisa dibuka', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lembur-bk-'));
  try {
    const file = path.join(dir, 'sumber.db');
    const db = openDb(file);
    seed(db, { username: 'admin', password: 'RahasiaBanget1' });
    const out = backup(db, path.join(dir, 'backups'), new Date(2026, 9, 29, 8, 5, 9));
    assert.equal(path.basename(out), 'lembur-20261029-080509.db');
    const copy = openDb(out);
    assert.equal(copy.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
    copy.close(); db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backup menolak database :memory:', () => {
  const db = openDb(':memory:');
  assert.throws(() => backup(db, os.tmpdir(), new Date(), ':memory:'), /:memory:/);
});

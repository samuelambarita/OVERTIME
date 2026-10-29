const test = require('node:test');
const assert = require('node:assert');
const { openDb, tx } = require('../../src/db');

const TABLES = ['departments', 'users', 'overtime_requests', 'overtime_participants',
  'participant_chain', 'notifications', 'audit_log', 'sessions'];

test('openDb membuat semua tabel', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of TABLES) assert.ok(names.includes(t), `tabel ${t} tidak ada`);
});

test('foreign_keys aktif', () => {
  const db = openDb(':memory:');
  assert.strictEqual(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('insert user dengan department_id tidak ada ditolak', () => {
  const db = openDb(':memory:');
  assert.throws(() => db.prepare(
    "INSERT INTO users(username,password_hash,name,level,department_id,created_at) VALUES('abc','x','A',1,999,'2026-01-01T00:00:00')"
  ).run());
});

test('tx rollback saat error', () => {
  const db = openDb(':memory:');
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO departments(name,category) VALUES('IT Ops','IT')").run();
    throw new Error('x');
  }), /x/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM departments').get().c, 0);
});

test('tx commit dan mengembalikan nilai', () => {
  const db = openDb(':memory:');
  const r = tx(db, () => { db.prepare("INSERT INTO departments(name,category) VALUES('HR','NON_IT')").run(); return 7; });
  assert.strictEqual(r, 7);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM departments').get().c, 1);
});

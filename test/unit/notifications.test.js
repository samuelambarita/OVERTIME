const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const n = require('../../src/services/notifications');

test('notifikasi: kirim, hitung belum dibaca, tandai dibaca', () => {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  n.notify(db, ids.budi, 'Halo 1', '/a');
  n.notify(db, ids.budi, 'Halo 2', null);
  n.notify(db, ids.sari, 'Lain', null);
  assert.strictEqual(n.unreadCount(db, ids.budi), 2);
  const list = n.listNotifications(db, ids.budi, 1);
  assert.strictEqual(list.total, 2);
  assert.strictEqual(list.rows.length, 2);
  n.markRead(db, ids.budi, list.rows[0].id);
  assert.strictEqual(n.unreadCount(db, ids.budi), 1);
  // tidak bisa menandai milik orang lain
  n.markRead(db, ids.sari, list.rows[1].id);
  assert.strictEqual(n.unreadCount(db, ids.budi), 1);
  n.markRead(db, ids.budi, 'all');
  assert.strictEqual(n.unreadCount(db, ids.budi), 0);
  assert.strictEqual(n.unreadCount(db, ids.sari), 1);
});

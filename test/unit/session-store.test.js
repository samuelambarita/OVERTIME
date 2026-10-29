const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const { SqliteStore } = require('../../src/db/session-store');

const call = (fn, ...a) => new Promise((res, rej) => fn(...a, (e, v) => (e ? rej(e) : res(v))));

test('set/get/touch/destroy', async () => {
  const store = new SqliteStore(openDb(':memory:'));
  const sess = { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, userId: 1 };
  await call(store.set.bind(store), 's1', sess);
  assert.equal((await call(store.get.bind(store), 's1')).userId, 1);
  await call(store.touch.bind(store), 's1', sess);
  await call(store.destroy.bind(store), 's1');
  assert.equal(await call(store.get.bind(store), 's1'), null);
});

test('baris kedaluwarsa dibersihkan (paling sering sekali per menit)', async () => {
  const db = openDb(':memory:');
  const store = new SqliteStore(db);
  const old = { cookie: { expires: new Date(Date.now() - 1000).toISOString() } };
  await call(store.set.bind(store), 'old1', old);
  await call(store.set.bind(store), 'old2', old);
  // purge pertama sudah berjalan pada set() pertama; paksa jendela baru
  store.lastPurge = 0;
  await call(store.get.bind(store), 'other');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 0);
  // dalam 1 menit tidak purge lagi
  await call(store.set.bind(store), 'old3', old);
  await call(store.get.bind(store), 'other');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
});

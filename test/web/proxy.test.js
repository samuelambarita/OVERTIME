const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../../src/db');
const { buildDemoOrg } = require('../../src/db/demo');
const { createApp } = require('../../src/app');
const { Client } = require('../helpers');

async function start(trustProxy) {
  const db = openDb(':memory:');
  buildDemoOrg(db);
  const app = createApp({ db, sessionSecret: 's', trustProxy });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { app, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); server.closeAllConnections(); } };
}

async function fail(base, ip, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const body = new URLSearchParams({ username: 'budi', password: 'salah' });
    const c = new Client(base);
    await c.get('/login');
    body.set('_csrf', c.csrf);
    const res = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': c.csrf, cookie: c._cookieHeader(), 'x-forwarded-for': ip },
      body,
    });
    out.push(res.status);
  }
  return out;
}

test('trustProxy=true: rate limit memakai IP dari X-Forwarded-For', async () => {
  const s = await start(true);
  try {
    assert.equal(s.app.get('trust proxy'), 1);
    await fail(s.base, '10.0.0.1', 5);
    assert.equal((await fail(s.base, '10.0.0.1', 1))[0], 429);
    assert.equal((await fail(s.base, '10.0.0.2', 1))[0], 200);
  } finally { s.close(); }
});

test('trustProxy default: X-Forwarded-For diabaikan', async () => {
  const s = await start(false);
  try {
    assert.equal(s.app.get('trust proxy'), false);
    await fail(s.base, '10.0.0.1', 5);
    assert.equal((await fail(s.base, '10.0.0.2', 1))[0], 429);
  } finally { s.close(); }
});

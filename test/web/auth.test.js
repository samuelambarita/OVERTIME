const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, login } = require('../helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

test('GET / tanpa login redirect ke /login', async () => {
  const res = await new Client(app.base).get('/');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/login');
});

test('login benar -> 302 ke / lalu beranda memuat nama user', async () => {
  const c = new Client(app.base);
  await c.get('/login');
  const res = await c.post('/login', { username: 'budi', password: 'Password123' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/');
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Budi/i);
  assert.doesNotMatch(home.text, /<script>|style="/);
});

test('login salah -> 200 dengan pesan', async () => {
  const c = new Client(app.base);
  const res = await c.post('/login', { username: 'budi', password: 'salah' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Username atau password salah\./);
});

test('6x salah -> 429 dengan pesan blokir', async () => {
  const c = new Client(app.base);
  for (let i = 0; i < 5; i++) {
    const r = await c.post('/login', { username: 'andi', password: 'salah' });
    assert.equal(r.status, 200);
  }
  const res = await c.post('/login', { username: 'andi', password: 'salah' });
  assert.equal(res.status, 429);
  assert.match(res.text, /Terlalu banyak percobaan\. Coba lagi dalam 15 menit\./);
});

test('must_change_password -> redirect ke /ganti-password, ganti sukses -> / 200', async () => {
  app.db.prepare("UPDATE users SET must_change_password = 1 WHERE username = 'sari'").run();
  const c = await login(app.base, 'sari');
  const home = await c.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.location, '/ganti-password');
  const bad = await c.post('/ganti-password', {
    old_password: 'Password123', new_password: 'pendek', confirm_password: 'pendek',
  });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Password minimal 8 karakter\./);
  const ok = await c.post('/ganti-password', {
    old_password: 'Password123', new_password: 'PasswordBaru1', confirm_password: 'PasswordBaru1',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.location, '/');
  const after = await c.get('/');
  assert.equal(after.status, 200);
  assert.match(after.text, /Password berhasil diganti\./);
});

test('POST tanpa _csrf -> 403', async () => {
  const c = new Client(app.base);
  await c.get('/login');
  const res = await c.post('/login', { _csrf: null, username: 'budi', password: 'Password123' });
  assert.equal(res.status, 403);
});

test('header keamanan hadir', async () => {
  const res = await new Client(app.base).get('/login');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'same-origin');
});

test('logout -> GET / redirect ke /login', async () => {
  const c = await login(app.base, 'mgrit');
  assert.equal((await c.get('/')).status, 200);
  const out = await c.post('/logout');
  assert.equal(out.status, 302);
  assert.equal((await c.get('/')).location, '/login');
});

test('user dinonaktifkan -> sesi dianggap keluar', async () => {
  const c = await login(app.base, 'leadit');
  app.db.prepare("UPDATE users SET is_active = 0 WHERE username = 'leadit'").run();
  const res = await c.get('/');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/login');
});

test('nav menampilkan menu sesuai level', async () => {
  const mgr = await (await login(app.base, 'mgrfin')).get('/');
  assert.match(mgr.text, /Persetujuan/);
  assert.doesNotMatch(mgr.text, /Persetujuan HR/);
  const hr = await (await login(app.base, 'hr')).get('/');
  assert.match(hr.text, /Persetujuan HR/);
  const emp = await (await login(app.base, 'admin')).get('/');
  assert.doesNotMatch(emp.text, /href="\/persetujuan"/);
  assert.match(emp.text, /href="\/admin\/users"/);
});

const NO_LEAK = (text) => {
  assert.doesNotMatch(text, / at /);
  assert.doesNotMatch(text, /node_modules/);
  assert.ok(!text.includes('src' + String.fromCharCode(92)));
};

test('charset tidak dikenal pada POST /login -> 4xx tanpa stack trace', async () => {
  const res = await fetch(`${app.base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=foo' },
    body: 'username=a&password=b',
  });
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  NO_LEAK(await res.text());
});

test('body terlalu besar -> 4xx tanpa stack trace', async () => {
  const res = await fetch(`${app.base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${'a'.repeat(200 * 1024)}`,
  });
  assert.equal(res.status, 413);
  NO_LEAK(await res.text());
});

test('POST text/plain dengan header csrf valid tidak crash', async () => {
  const c = new Client(app.base);
  await c.get('/login');
  const res = await fetch(`${app.base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-csrf-token': c.csrf, cookie: c._cookieHeader() },
    body: 'hai',
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Username atau password salah\./);
});

test('ganti password menulis audit_log dan tetap login', async () => {
  const c = await login(app.base, 'deputi');
  const res = await c.post('/ganti-password', {
    old_password: 'Password123', new_password: 'PasswordBaru2', confirm_password: 'PasswordBaru2',
  });
  assert.equal(res.status, 302);
  assert.equal((await c.get('/')).status, 200);
  const row = app.db.prepare("SELECT * FROM audit_log WHERE action = 'user.change_password' AND entity_id = ?").get(app.ids.deputi);
  assert.ok(row);
  assert.equal(row.actor_id, app.ids.deputi);
});

test('requireLevel/requireAdmin: 403 untuk level rendah, redirect bila belum login', async () => {
  const { requireLevel, requireAdmin } = require('../../src/middleware/auth');
  const a2 = await startApp({
    extend: (a) => {
      a.get('/uji-level', requireLevel(3), (req, res) => res.send('ok'));
      a.get('/uji-admin', requireAdmin, (req, res) => res.send('ok'));
    },
  });
  try {
    assert.equal((await new Client(a2.base).get('/uji-level')).location, '/login');
    const emp = await login(a2.base, 'budi');
    assert.equal((await emp.get('/uji-level')).status, 403);
    assert.equal((await emp.get('/uji-admin')).status, 403);
    const mgr = await login(a2.base, 'mgrit');
    assert.equal((await mgr.get('/uji-level')).status, 200);
    a2.db.prepare("UPDATE users SET must_change_password = 1 WHERE username = 'mgrit'").run();
    assert.equal((await mgr.get('/uji-level')).location, '/ganti-password');
    const adm = await login(a2.base, 'admin');
    assert.equal((await adm.get('/uji-admin')).status, 200);
  } finally {
    await a2.close();
  }
});

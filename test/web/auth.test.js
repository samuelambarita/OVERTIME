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
  assert.match(emp.text, /href="\/admin"/);
});

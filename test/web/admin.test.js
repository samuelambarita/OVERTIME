const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, login } = require('../helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.close(); });

const dept = (n) => app.db.prepare('SELECT id FROM departments WHERE name = ?').get(n).id;
const newUser = (over = {}) => ({
  username: 'rina', password: 'Rahasia123', name: 'Rina', nik: '', email: '',
  level: '1', departmentId: String(dept('IT')), supervisorId: String(app.ids.leadit), ...over,
});

test('budi tidak boleh membuka halaman admin (403)', async () => {
  const c = await login(app.base, 'budi');
  for (const p of ['/admin/users', '/admin/users/baru', '/admin/departemen', '/admin/audit']) {
    assert.equal((await c.get(p)).status, 403, p);
  }
  assert.equal((await c.post('/admin/users', newUser())).status, 403);
});

test('admin membuat rina; rina login diarahkan ke /ganti-password; duplikat 422', async () => {
  const c = await login(app.base, 'admin');
  const form = await c.get('/admin/users/baru');
  assert.equal(form.status, 200);
  assert.match(form.text, /Mgrit — Manager — IT/);
  const res = await c.post('/admin/users', newUser());
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/users');

  const rc = new Client(app.base);
  await rc.get('/login');
  const lr = await rc.post('/login', { username: 'rina', password: 'Rahasia123' });
  assert.equal(lr.status, 302);
  assert.equal(lr.location, '/');
  assert.equal((await rc.get('/')).location, '/ganti-password'); // gerbang wajib ganti password

  const dup = await c.post('/admin/users', newUser({ username: 'Rina', password: 'RahasiaLain1', name: 'Rina Dua' }));
  assert.equal(dup.status, 422);
  assert.match(dup.text, /Username sudah dipakai\./);
  assert.match(dup.text, /Rina Dua/); // nilai tetap
  assert.ok(!dup.text.includes('RahasiaLain1')); // password tidak di-echo
});

test('warning atasan lebih rendah tampil sebagai flash kuning', async () => {
  const c = await login(app.base, 'admin');
  const res = await c.post('/admin/users', newUser({ username: 'tono', name: 'Tono', level: '3', supervisorId: String(app.ids.budi) }));
  assert.equal(res.status, 302);
  const list = await c.get('/admin/users');
  assert.match(list.text, /alert-warn/);
  assert.match(list.text, /Jabatan atasan lebih rendah/);
});

test('edit user, cari, reset password', async () => {
  const c = await login(app.base, 'admin');
  await c.post('/admin/users', newUser());
  const id = app.db.prepare("SELECT id FROM users WHERE username='rina'").get().id;
  const edit = await c.get(`/admin/users/${id}/edit`);
  assert.equal(edit.status, 200);
  assert.match(edit.text, /value="Rina"/);
  const up = await c.post(`/admin/users/${id}`, newUser({ name: 'Rina Baru' }));
  assert.equal(up.status, 302);
  assert.equal(app.db.prepare('SELECT name FROM users WHERE id=?').get(id).name, 'Rina Baru');
  const bad = await c.post(`/admin/users/${id}`, newUser({ name: '' }));
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Nama wajib diisi\./);
  assert.match((await c.get('/admin/users?q=rina')).text, /Rina Baru/);
  const rp = await c.post(`/admin/users/${id}/reset-password`, { password: 'pendek' });
  assert.equal(rp.status, 302);
  assert.match((await c.get('/admin/users')).text, /Password minimal 8 karakter\./);
  await c.post(`/admin/users/${id}/reset-password`, { password: 'PasswordBaru1' });
  const rc = new Client(app.base);
  await rc.get('/login');
  assert.equal((await rc.post('/login', { username: 'rina', password: 'PasswordBaru1' })).status, 302);
  assert.equal((await c.get('/admin/users/abc/edit')).status, 404);
});

test('admin menonaktifkan mgrit -> flash memuat 2 bawahan', async () => {
  const c = await login(app.base, 'admin');
  const res = await c.post(`/admin/users/${app.ids.mgrit}/status`, { active: '0' });
  assert.equal(res.status, 302);
  const list = await c.get('/admin/users');
  assert.match(list.text, /User dinonaktifkan\. 2 bawahan masih menunjuk user ini sebagai atasan\./);
  await c.post(`/admin/users/${app.ids.mgrit}/status`, { active: '1' });
  assert.equal(app.db.prepare('SELECT is_active FROM users WHERE id=?').get(app.ids.mgrit).is_active, 1);
});

test('admin tidak bisa menonaktifkan admin terakhir', async () => {
  const c = await login(app.base, 'admin');
  await c.post(`/admin/users/${app.ids.admin}/status`, { active: '0' });
  assert.match((await c.get('/admin/users')).text, /Minimal harus ada satu admin aktif\./);
});

test('departemen: tambah, ubah, hapus; hapus IT ditolak', async () => {
  const c = await login(app.base, 'admin');
  assert.match((await c.get('/admin/departemen')).text, /Finance/);
  assert.equal((await c.post('/admin/departemen', { name: 'Ops', category: 'NON_IT' })).status, 302);
  const ops = dept('Ops');
  await c.post(`/admin/departemen/${ops}`, { name: 'Operasi', category: 'IT' });
  assert.equal(app.db.prepare('SELECT name FROM departments WHERE id=?').get(ops).name, 'Operasi');
  const dupe = await c.post('/admin/departemen', { name: 'Operasi', category: 'IT' });
  assert.equal(dupe.status, 302);
  assert.match((await c.get('/admin/departemen')).text, /Nama departemen sudah dipakai\./);
  await c.post(`/admin/departemen/${ops}/hapus`, {});
  assert.equal(app.db.prepare('SELECT 1 FROM departments WHERE id=?').get(ops), undefined);
  await c.post(`/admin/departemen/${dept('IT')}/hapus`, {});
  assert.match((await c.get('/admin/departemen')).text, /Departemen masih memiliki user\./);
});

test('/admin/audit memuat user.create dan filter action', async () => {
  const c = await login(app.base, 'admin');
  const res = await c.get('/admin/audit');
  assert.equal(res.status, 200);
  assert.match(res.text, /user\.create/);
  const f = await c.get('/admin/audit?action=department.');
  assert.ok(!f.text.includes('user.create'));
  assert.match(f.text, /department\.create/);
});

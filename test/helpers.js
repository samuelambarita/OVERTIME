const { openDb } = require('../src/db');
const { buildDemoOrg } = require('../src/db/demo');
const { createApp } = require('../src/app');

async function startApp() {
  const db = openDb(':memory:');
  const ids = buildDemoOrg(db);
  const app = createApp({ db, sessionSecret: 'test-secret', secureCookie: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  return { db, ids, base, close };
}

// HTTP client dengan cookie jar, tanpa auto-redirect, dan pelacakan token CSRF.
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = null;
  }

  _cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async _send(method, path, { body, htmx } = {}) {
    const headers = {};
    const cookie = this._cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (htmx) headers['hx-request'] = 'true';
    if (body !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      headers['x-csrf-token'] = body.get('_csrf') || '';
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else {
        if (name === 'lembur.sid' && this.cookies.get(name) !== value) this.csrf = null; // sesi baru => token lama tidak berlaku
        this.cookies.set(name, value);
      }
    }
    const text = await res.text();
    const m = /name="_csrf" value="([0-9a-f]+)"/.exec(text) || /x-csrf-token":"([0-9a-f]+)"/.exec(text);
    if (m) this.csrf = m[1];
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  get(path, { htmx } = {}) {
    return this._send('GET', path, { htmx });
  }

  // fields: objek; nilai array dikirim sebagai field berulang. fields._csrf bisa diisi manual
  // (mis. untuk menguji token salah); kunci `_csrf: null` berarti kirim tanpa token.
  async post(path, fields = {}, { htmx } = {}) {
    if ('_csrf' in fields) { /* token diatur pemanggil */ } else {
      for (const p of ['/login', '/', '/ganti-password']) {
        if (this.csrf) break;
        await this.get(p);
      }
    }
    const body = new URLSearchParams();
    const all = '_csrf' in fields ? fields : { _csrf: this.csrf, ...fields };
    for (const [k, v] of Object.entries(all)) {
      if (v == null) continue;
      for (const item of Array.isArray(v) ? v : [v]) body.append(k, String(item));
    }
    return this._send('POST', path, { body, htmx });
  }
}

async function login(base, username, password = 'Password123') {
  const client = new Client(base);
  await client.get('/login');
  const res = await client.post('/login', { username, password });
  if (res.status !== 302) throw new Error(`Login ${username} gagal (status ${res.status})`);
  return client;
}

module.exports = { startApp, Client, login };

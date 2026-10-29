const bcrypt = require('bcryptjs');
const { openDb, tx } = require('./index');
const { buildDemoOrg } = require('./demo');
const { log } = require('../services/audit');
const { nowIso } = require('../services/time');

const DEMO_PASSWORD = 'Password123';
const DEMO_USERS = ['presdir', 'direktur', 'deputi', 'hr', 'smit', 'mgrit', 'leadit', 'budi', 'andi', 'mgrfin', 'sari', 'admin'];

// Mengembalikan { skipped, messages }; tidak pernah menyertakan password admin di pesan.
function seed(db, { username, password, demo = false } = {}) {
  const messages = [];
  const usersEmpty = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  let skipped = false;

  if (demo) {
    if (usersEmpty) {
      buildDemoOrg(db, DEMO_PASSWORD);
      messages.push(`Data demo dibuat. Password semua akun: ${DEMO_PASSWORD} (hanya untuk demo!)`);
      messages.push(`Username: ${DEMO_USERS.join(', ')}`);
    } else {
      messages.push('Tabel users tidak kosong, data demo dilewati.');
      skipped = true;
    }
    return { skipped, messages };
  }

  if (db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get()) {
    return { skipped: true, messages: ['Admin sudah ada, dilewati.'] };
  }
  const uname = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!/^[a-z0-9._]{3,32}$/.test(uname)) throw new Error('Username admin tidak valid (3-32 karakter: a-z, 0-9, titik, underscore).');
  if (typeof password !== 'string' || password.length < 8) throw new Error('Password admin minimal 8 karakter.');
  const hash = bcrypt.hashSync(password, 10);
  tx(db, () => {
    let dept = db.prepare('SELECT id FROM departments ORDER BY id LIMIT 1').get();
    if (!dept) {
      dept = { id: Number(db.prepare("INSERT INTO departments (name, category) VALUES ('Umum', 'NON_IT')").run().lastInsertRowid) };
    }
    const id = Number(db.prepare(
      `INSERT INTO users (username, password_hash, must_change_password, name, level, department_id, supervisor_id, is_admin, is_active, created_at)
       VALUES (?, ?, 1, ?, 1, ?, NULL, 1, 1, ?)`
    ).run(uname, hash, 'Administrator', dept.id, nowIso()).lastInsertRowid);
    log(db, null, 'user.create', 'user', id, { username: uname, bootstrap: true });
  });
  messages.push(`Admin dibuat: ${uname} (wajib ganti password saat login pertama).`);
  return { skipped, messages };
}

function parseArgs(argv, env) {
  const out = { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, demo: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--demo') out.demo = true;
    else if (argv[i] === '--username') out.username = argv[++i];
    else if (argv[i] === '--password') out.password = argv[++i];
  }
  return out;
}

if (require.main === module) {
  require('../config');
  const opts = parseArgs(process.argv.slice(2), process.env);
  if (!opts.demo && (!opts.password || opts.password.length < 8)) {
    console.error('Pemakaian: npm run seed -- --username <username> --password <password minimal 8 karakter>');
    console.error('Atau isi ADMIN_USERNAME dan ADMIN_PASSWORD di .env. Untuk data demo: npm run seed -- --demo');
    process.exit(1);
  }
  const db = openDb();
  try {
    for (const m of seed(db, opts).messages) console.log(m);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { seed };

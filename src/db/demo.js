const bcrypt = require('bcryptjs');
const { nowIso } = require('../services/time');

// username, level, atasan, departemen, isAdmin
const ORG = [
  ['presdir', 8, null, 'Finance'],
  ['direktur', 7, 'presdir', 'Finance'],
  ['deputi', 6, 'presdir', 'Finance'],
  ['hr', 5, 'direktur', 'Finance'],
  ['smit', 4, 'direktur', 'IT'],
  ['mgrit', 3, 'smit', 'IT'],
  ['leadit', 2, 'mgrit', 'IT'],
  ['budi', 1, 'leadit', 'IT'],
  ['andi', 1, 'leadit', 'IT'],
  ['mgrfin', 3, 'direktur', 'Finance'],
  ['sari', 1, 'mgrfin', 'Finance'],
  ['admin', 1, 'mgrit', 'IT', true],
];

function buildDemoOrg(db, password = 'Password123') {
  const hash = bcrypt.hashSync(password, 10);
  const now = nowIso();
  const dept = {};
  for (const [name, category] of [['IT', 'IT'], ['Finance', 'NON_IT']]) {
    dept[name] = Number(db.prepare('INSERT INTO departments (name, category) VALUES (?, ?)').run(name, category).lastInsertRowid);
  }
  const ids = {};
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, must_change_password, name, level, department_id, supervisor_id, is_admin, is_active, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, 1, ?)`
  );
  for (const [username, level, boss, d, isAdmin] of ORG) {
    const name = username.charAt(0).toUpperCase() + username.slice(1);
    ids[username] = Number(insert.run(username, hash, name, level, dept[d], boss ? ids[boss] : null, isAdmin ? 1 : 0, now).lastInsertRowid);
  }
  return ids;
}

module.exports = { buildDemoOrg };

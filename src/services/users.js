const bcrypt = require('bcryptjs');
const { tx } = require('../db');
const { ValidationError, NotFoundError } = require('../errors');
const { LEVELS } = require('./levels');
const { nowIso } = require('./time');
const audit = require('./audit');
const { pageParams } = require('./paging');

const USERNAME_RE = /^[a-z0-9._]{3,32}$/;
const COLS = `id, username, must_change_password, name, nik, email, level, department_id,
  supervisor_id, is_admin, is_active, created_at`;
const PW_MSG = 'Password minimal 8 karakter.';

function validateUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u.toLowerCase())
    ? null
    : 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah.';
}

function getUser(db, id) {
  return db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id);
}

function supervisorChain(db, userId) {
  const chain = [];
  const seen = new Set([userId]);
  let cur = db.prepare('SELECT supervisor_id FROM users WHERE id = ?').get(userId);
  while (cur && cur.supervisor_id != null && !seen.has(cur.supervisor_id)) {
    const u = getUser(db, cur.supervisor_id);
    if (!u) break;
    seen.add(u.id);
    chain.push(u);
    cur = { supervisor_id: u.supervisor_id };
  }
  return chain;
}

const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Validasi field bersama untuk create/update. selfId = null saat create.
function validateFields(db, data, selfId) {
  const errors = [];
  const warnings = [];
  if (!(typeof data.name === 'string' && data.name.trim())) errors.push('Nama wajib diisi.');
  if (!Number.isInteger(data.level) || data.level < LEVELS.KARYAWAN || data.level > LEVELS.PRESDIR) {
    errors.push('Jabatan tidak valid.');
  }
  if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(data.departmentId)) {
    errors.push('Departemen tidak ditemukan.');
  }
  const nik = blank(data.nik);
  if (nik) {
    const dup = db.prepare('SELECT id FROM users WHERE nik = ?').get(nik);
    if (dup && dup.id !== selfId) errors.push('NIK sudah dipakai.');
  }
  const supId = data.supervisorId ?? null;
  if (supId == null) {
    if (data.level !== LEVELS.PRESDIR) errors.push('Atasan wajib diisi kecuali Presdir.');
  } else if (selfId != null && supId === selfId) {
    errors.push('Atasan tidak boleh diri sendiri.');
  } else {
    const sup = getUser(db, supId);
    if (!sup) errors.push('Atasan tidak ditemukan.');
    else {
      if (selfId != null && [sup, ...supervisorChain(db, sup.id)].some(u => u.id === selfId)) {
        errors.push('Atasan membentuk siklus.');
      }
      if (sup.level < data.level) warnings.push('Jabatan atasan lebih rendah dari bawahan.');
    }
  }
  return { errors, warnings, nik };
}

function createUser(db, actor, data) {
  return tx(db, () => {
    const errors = [];
    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    const uErr = validateUsername(username);
    if (uErr) errors.push(uErr);
    else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) errors.push('Username sudah dipakai.');
    if (typeof data.password !== 'string' || data.password.length < 8) errors.push(PW_MSG);
    const v = validateFields(db, data, null);
    errors.push(...v.errors);
    if (errors.length) throw new ValidationError(errors);

    const id = Number(db.prepare(
      `INSERT INTO users (username, password_hash, must_change_password, name, nik, email, level,
         department_id, supervisor_id, is_admin, is_active, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(username, bcrypt.hashSync(data.password, 10), data.name.trim(), v.nik, blank(data.email),
      data.level, data.departmentId, data.supervisorId ?? null, data.isAdmin ? 1 : 0, nowIso()).lastInsertRowid);
    audit.log(db, actor?.id, 'user.create', 'user', id, { username, level: data.level });
    return { id, warnings: v.warnings };
  });
}

function updateUser(db, actor, id, data) {
  return tx(db, () => {
    const cur = getUser(db, id);
    if (!cur) throw new NotFoundError();
    const merged = {
      name: cur.name, nik: cur.nik, email: cur.email, level: cur.level,
      departmentId: cur.department_id, supervisorId: cur.supervisor_id, isAdmin: !!cur.is_admin,
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    };
    const v = validateFields(db, merged, id);
    if (v.errors.length) throw new ValidationError(v.errors);
    if (cur.is_admin && cur.is_active && !merged.isAdmin && activeAdminCount(db, id) === 0) {
      throw new ValidationError(['Minimal harus ada satu admin aktif.']);
    }
    db.prepare(
      `UPDATE users SET name = ?, nik = ?, email = ?, level = ?, department_id = ?, supervisor_id = ?, is_admin = ?
       WHERE id = ?`
    ).run(merged.name.trim(), v.nik, blank(merged.email), merged.level, merged.departmentId,
      merged.supervisorId ?? null, merged.isAdmin ? 1 : 0, id);
    audit.log(db, actor?.id, 'user.update', 'user', id, { fields: Object.keys(data) });
    return { warnings: v.warnings };
  });
}

function resetPassword(db, actor, id, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new ValidationError([PW_MSG]);
  tx(db, () => {
    if (!getUser(db, id)) throw new NotFoundError();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 10), id);
    audit.log(db, actor?.id, 'user.reset_password', 'user', id);
  });
}

// Jumlah admin aktif selain excludeId.
function activeAdminCount(db, excludeId) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND is_active = 1 AND id != ?')
    .get(excludeId).c);
}

function setActive(db, actor, id, active) {
  return tx(db, () => {
    const u = getUser(db, id);
    if (!u) throw new NotFoundError();
    if (!active && u.is_admin && u.is_active && activeAdminCount(db, id) === 0) {
      throw new ValidationError(['Minimal harus ada satu admin aktif.']);
    }
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
    audit.log(db, actor?.id, active ? 'user.activate' : 'user.deactivate', 'user', id);
    const subordinates = Number(db.prepare(
      'SELECT COUNT(*) AS c FROM users WHERE supervisor_id = ? AND is_active = 1').get(id).c);
    return { subordinates };
  });
}

function authenticate(db, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username.trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null;
  return getUser(db, row.id);
}

function changePassword(db, userId, oldPw, newPw) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row) throw new NotFoundError();
  if (typeof oldPw !== 'string' || !bcrypt.compareSync(oldPw, row.password_hash)) {
    throw new ValidationError(['Password lama salah.']);
  }
  if (typeof newPw !== 'string' || newPw.length < 8) throw new ValidationError([PW_MSG]);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(newPw, 10), userId);
  audit.log(db, userId, 'user.change_password', 'user', userId);
}

const like = (q) => `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;

function listUsers(db, { q, page = 1 } = {}) {
  const where = q ? "WHERE (u.name LIKE @q ESCAPE '\\' OR u.username LIKE @q ESCAPE '\\' OR u.nik LIKE @q ESCAPE '\\')" : '';
  const params = q ? { q: like(q) } : {};
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM users u ${where}`).get(params).c);
  const { limit, offset } = pageParams(page);
  const rows = db.prepare(
    `SELECT u.id, u.username, u.must_change_password, u.name, u.nik, u.email, u.level, u.department_id,
       u.supervisor_id, u.is_admin, u.is_active, u.created_at, d.name AS department_name
     FROM users u JOIN departments d ON d.id = u.department_id ${where}
     ORDER BY u.name, u.id LIMIT ${limit} OFFSET ${offset}`
  ).all(params);
  return { rows, total };
}

function searchUsers(db, q, limit = 10) {
  const term = { q: like(q || '') };
  return db.prepare(
    `SELECT u.id, u.name, u.username, d.name AS department
     FROM users u JOIN departments d ON d.id = u.department_id
     WHERE u.is_active = 1 AND (u.name LIKE @q ESCAPE '\\' OR u.username LIKE @q ESCAPE '\\' OR u.nik LIKE @q ESCAPE '\\')
     ORDER BY u.name LIMIT ${Number(limit) | 0}`
  ).all(term);
}

module.exports = {
  validateUsername, createUser, updateUser, resetPassword, setActive, authenticate,
  changePassword, getUser, listUsers, searchUsers, supervisorChain,
};

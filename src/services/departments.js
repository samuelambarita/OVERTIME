const { tx } = require('../db');
const { ValidationError, NotFoundError } = require('../errors');
const audit = require('./audit');

const CATEGORIES = ['IT', 'NON_IT'];

function listDepartments(db) {
  return db.prepare(
    `SELECT d.id, d.name, d.category, COUNT(u.id) AS userCount
     FROM departments d LEFT JOIN users u ON u.department_id = d.id
     GROUP BY d.id ORDER BY d.name`
  ).all().map(r => ({ id: r.id, name: r.name, category: r.category, userCount: Number(r.userCount) }));
}

function validate(db, { name, category }, selfId = null) {
  const errors = [];
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) errors.push('Nama departemen wajib diisi.');
  else {
    const dup = db.prepare('SELECT id FROM departments WHERE lower(name) = lower(?)').get(n);
    if (dup && dup.id !== selfId) errors.push('Nama departemen sudah dipakai.');
  }
  if (!CATEGORIES.includes(category)) errors.push('Kategori departemen harus IT atau NON_IT.');
  if (errors.length) throw new ValidationError(errors);
  return n;
}

function createDepartment(db, actor, data) {
  return tx(db, () => {
    const name = validate(db, data);
    const id = Number(db.prepare('INSERT INTO departments (name, category) VALUES (?, ?)')
      .run(name, data.category).lastInsertRowid);
    audit.log(db, actor?.id, 'department.create', 'department', id, { name, category: data.category });
    return id;
  });
}

function updateDepartment(db, actor, id, data) {
  tx(db, () => {
    if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(id)) throw new NotFoundError();
    const name = validate(db, data, id);
    db.prepare('UPDATE departments SET name = ?, category = ? WHERE id = ?').run(name, data.category, id);
    audit.log(db, actor?.id, 'department.update', 'department', id, { name, category: data.category });
  });
}

function deleteDepartment(db, actor, id) {
  tx(db, () => {
    if (!db.prepare('SELECT 1 FROM departments WHERE id = ?').get(id)) throw new NotFoundError();
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM users WHERE department_id = ?').get(id);
    if (c > 0) throw new ValidationError(['Departemen masih memiliki user.']);
    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    audit.log(db, actor?.id, 'department.delete', 'department', id);
  });
}

module.exports = { listDepartments, createDepartment, updateDepartment, deleteDepartment };

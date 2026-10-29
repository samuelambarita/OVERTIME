const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../errors');
const users = require('../services/users');
const departments = require('../services/departments');
const { listAudit } = require('../services/audit');
const { pageParams } = require('../services/paging');
const { LEVEL_NAMES } = require('../services/levels');

const str = (v) => (typeof v === 'string' ? v : '');
const pageOf = (v) => pageParams(v).page;
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError();
  return n;
};
// Bilangan bulat dari string form; tidak valid -> 0 (ditolak oleh validasi service).
const intOf = (v) => {
  const n = Number(str(v).trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const optInt = (v) => (str(v).trim() === '' ? null : intOf(v));

function toQs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v != null && !(k === 'page' && v === 1)) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function userData(body) {
  return {
    name: str(body.name), nik: str(body.nik), email: str(body.email),
    level: intOf(body.level), departmentId: intOf(body.departmentId),
    supervisorId: optInt(body.supervisorId), isAdmin: str(body.isAdmin) === '1',
  };
}

// Nilai form yang ditampilkan ulang; password sengaja tidak pernah disertakan.
const valuesOf = (src, extra = {}) => ({
  username: str(src.username), name: str(src.name), nik: str(src.nik), email: str(src.email),
  level: str(src.level), departmentId: str(src.departmentId), supervisorId: str(src.supervisorId),
  isAdmin: str(src.isAdmin) === '1', ...extra,
});

function createAdminRoutes(db) {
  const router = express.Router();
  const flash = (req, type, message) => { req.session.flash = { type, message }; };

  const formView = (res, { mode, id, values, errors, status = 200 }) => {
    // Atasan saat ini tetap ditawarkan walau nonaktif, agar menyimpan form tidak gagal.
    const current = id ? (users.getUser(db, id) || {}).supervisor_id ?? null : null;
    const supervisors = db.prepare(
      `SELECT u.id, u.name, u.level, u.is_active, d.name AS department FROM users u
       JOIN departments d ON d.id = u.department_id WHERE u.is_active = 1 OR u.id = ? ORDER BY u.name, u.id`
    ).all(current).filter((s) => s.id !== id);
    res.view('admin-user-form', {
      title: mode === 'new' ? 'User Baru' : 'Ubah User', section: 'users', mode, id, values, errors,
      departments: departments.listDepartments(db), supervisors, LEVEL_NAMES,
    }, status);
  };

  router.get('/admin/users', requireAdmin, (req, res) => {
    const q = str(req.query.q).trim();
    const page = pageOf(req.query.page);
    const { rows, total } = users.listUsers(db, { q: q || undefined, page });
    res.view('admin-users', {
      title: 'Admin: Users', section: 'users', rows, total, page, q,
      base: '/admin/users' + toQs({ q }),
    });
  });

  router.get('/admin/users/baru', requireAdmin, (req, res) => {
    formView(res, { mode: 'new', values: valuesOf({ level: '1' }) });
  });

  router.post('/admin/users', requireAdmin, (req, res) => {
    try {
      const { warnings } = users.createUser(db, req.user, {
        username: str(req.body.username), password: str(req.body.password), ...userData(req.body),
      });
      if (warnings.length) flash(req, 'warning', `User dibuat. ${warnings.join(' ')}`);
      else flash(req, 'success', 'User dibuat.');
      res.redirect('/admin/users');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      formView(res, { mode: 'new', values: valuesOf(req.body), errors: e.errors, status: 422 });
    }
  });

  router.get('/admin/users/:id/edit', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const u = users.getUser(db, id);
    if (!u) throw new NotFoundError();
    formView(res, {
      mode: 'edit', id,
      values: valuesOf({
        username: u.username, name: u.name, nik: u.nik || '', email: u.email || '', level: String(u.level),
        departmentId: String(u.department_id), supervisorId: u.supervisor_id == null ? '' : String(u.supervisor_id),
        isAdmin: u.is_admin ? '1' : '',
      }),
    });
  });

  router.post('/admin/users/:id', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const u = users.getUser(db, id);
    if (!u) throw new NotFoundError();
    try {
      const { warnings } = users.updateUser(db, req.user, id, userData(req.body));
      if (warnings.length) flash(req, 'warning', `User diperbarui. ${warnings.join(' ')}`);
      else flash(req, 'success', 'User diperbarui.');
      res.redirect('/admin/users');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      formView(res, { mode: 'edit', id, values: valuesOf(req.body, { username: u.username }), errors: e.errors, status: 422 });
    }
  });

  router.post('/admin/users/:id/reset-password', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    try {
      users.resetPassword(db, req.user, id, str(req.body.password));
      flash(req, 'success', 'Password direset. User wajib menggantinya saat login berikutnya.');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      flash(req, 'error', e.errors.join(' '));
    }
    res.redirect('/admin/users');
  });

  router.post('/admin/users/:id/status', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const active = str(req.body.active) === '1';
    try {
      const { subordinates } = users.setActive(db, req.user, id, active);
      if (active) flash(req, 'success', 'User diaktifkan.');
      else {
        const note = subordinates > 0 ? ` ${subordinates} bawahan masih menunjuk user ini sebagai atasan.` : '';
        flash(req, subordinates > 0 ? 'warning' : 'success', `User dinonaktifkan.${note}`);
      }
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      flash(req, 'error', e.errors.join(' '));
    }
    res.redirect('/admin/users');
  });

  router.get('/admin/departemen', requireAdmin, (req, res) => {
    res.view('admin-departments', { title: 'Admin: Departemen', section: 'departments', departments: departments.listDepartments(db) });
  });

  const deptAction = (fn, okMessage) => (req, res) => {
    try {
      fn(req);
      flash(req, 'success', okMessage);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      flash(req, 'error', e.errors.join(' '));
    }
    res.redirect('/admin/departemen');
  };
  const deptData = (req) => ({ name: str(req.body.name), category: str(req.body.category) });

  router.post('/admin/departemen', requireAdmin,
    deptAction((req) => departments.createDepartment(db, req.user, deptData(req)), 'Departemen dibuat.'));
  router.post('/admin/departemen/:id', requireAdmin,
    deptAction((req) => departments.updateDepartment(db, req.user, idParam(req.params.id), deptData(req)), 'Departemen diperbarui.'));
  router.post('/admin/departemen/:id/hapus', requireAdmin,
    deptAction((req) => departments.deleteDepartment(db, req.user, idParam(req.params.id)), 'Departemen dihapus.'));

  router.get('/admin/audit', requireAdmin, (req, res) => {
    const action = str(req.query.action).trim();
    const page = pageOf(req.query.page);
    const { rows, total } = listAudit(db, { action: action || undefined, page });
    res.view('admin-audit', {
      title: 'Admin: Audit', section: 'audit', rows, total, page, action,
      base: '/admin/audit' + toQs({ action }),
    });
  });

  return router;
}

module.exports = { createAdminRoutes };

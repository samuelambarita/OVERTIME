const express = require('express');
const { requireLevel } = require('../middleware/auth');
const { ValidationError } = require('../errors');
const { decideManager, decideHr } = require('../services/decisions');
const { listManagerQueue, listHrQueue } = require('../services/queries');
const { listDepartments } = require('../services/departments');
const { formatHours, durationMinutes } = require('../services/time');
const { checkWarnings } = require('../services/overtime');

const str = (v) => (typeof v === 'string' ? v : '');
const pageOf = (v) => Math.max(1, Math.floor(Number(v)) || 1);

// Parameter query yang dipertahankan; semuanya dinormalisasi (whitelist).
function managerQuery(q) {
  return { tab: q.tab === 'team' ? 'team' : 'mine', page: pageOf(q.page) };
}
function hrQuery(q) {
  const dep = Number(str(q.departmentId));
  return {
    departmentId: Number.isInteger(dep) && dep > 0 ? dep : '',
    category: ['IT', 'NON_IT'].includes(q.category) ? q.category : '',
    page: pageOf(q.page),
  };
}
function toQs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v != null && !(k === 'page' && v === 1)) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function createApprovalRoutes(db) {
  const router = express.Router();

  const handlePost = (decide, path, readQuery) => (req, res) => {
    const ids = [].concat(req.body.ids || []).map(Number).filter(Number.isInteger);
    try {
      if (!ids.length) throw new ValidationError(['Pilih minimal satu peserta.']);
      const { done, skipped } = decide(db, req.user, ids, str(req.body.decision), str(req.body.note), new Date());
      req.session.flash = {
        type: 'success',
        message: `${done} diproses${skipped > 0 ? `, ${skipped} dilewati` : ''}.`,
      };
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      req.session.flash = { type: 'error', message: e.errors.join(' ') };
    }
    res.redirect(path + toQs(readQuery(req.query)));
  };

  router.get('/persetujuan', requireLevel(3), (req, res) => {
    const q = managerQuery(req.query);
    const { rows, total } = listManagerQueue(db, req.user, { scope: q.tab, page: q.page });
    res.view('approvals-manager', {
      title: 'Persetujuan', rows, total, page: q.page, tab: q.tab,
      action: '/persetujuan' + toQs(q), base: `/persetujuan?tab=${q.tab}`,
      formatHours, durationMinutes,
    });
  });
  router.post('/persetujuan', requireLevel(3), handlePost(decideManager, '/persetujuan', managerQuery));

  router.get('/persetujuan-hr', requireLevel(5), (req, res) => {
    const q = hrQuery(req.query);
    const { rows, total } = listHrQueue(db, req.user, {
      departmentId: q.departmentId || undefined, category: q.category || undefined, page: q.page,
    });
    for (const r of rows) {
      r.warnings = checkWarnings(db, [r.user_id], { workDate: r.work_date, startTime: r.start_time, endTime: r.end_time }, r.request_id);
    }
    const filterQs = toQs({ departmentId: q.departmentId, category: q.category });
    res.view('approvals-hr', {
      title: 'Persetujuan HR', rows, total, page: q.page, departments: listDepartments(db),
      departmentId: q.departmentId, category: q.category,
      action: '/persetujuan-hr' + toQs(q), base: '/persetujuan-hr' + filterQs,
      formatHours, durationMinutes,
    });
  });
  router.post('/persetujuan-hr', requireLevel(5), handlePost(decideHr, '/persetujuan-hr', hrQuery));

  return router;
}

module.exports = { createApprovalRoutes };

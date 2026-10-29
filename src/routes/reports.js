const express = require('express');
const { requireLevel } = require('../middleware/auth');
const { recap, summarize, toCsv } = require('../services/reports');
const { listDepartments } = require('../services/departments');
const { formatDate, formatHours } = require('../services/time');
const { pageParams, PAGE_SIZE } = require('../services/paging');

const str = (v) => (typeof v === 'string' ? v : '');
const STATUSES = ['', 'ALL', 'APPROVED', 'REJECTED', 'WAITING_MANAGER', 'WAITING_HR'];

function validDate(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime()) && formatDate(d) === s ? s : null;
}

// Semua parameter dinormalisasi (whitelist); tanggal tidak valid -> default.
function filtersOf(q) {
  const today = new Date();
  const dep = Number(str(q.departmentId));
  const status = str(q.status);
  return {
    from: validDate(q.from) || formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: validDate(q.to) || formatDate(today),
    departmentId: Number.isInteger(dep) && dep > 0 ? dep : '',
    category: ['IT', 'NON_IT'].includes(q.category) ? q.category : '',
    // Parameter status tidak ada -> APPROVED; '' (pilihan "Semua") -> tanpa filter.
    status: q.status === undefined ? 'APPROVED' : (STATUSES.includes(status) ? status : 'APPROVED'),
  };
}

function toQs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function createReportRoutes(db) {
  const router = express.Router();
  const load = (req) => {
    const f = filtersOf(req.query);
    const rows = recap(db, req.user, {
      from: f.from, to: f.to, departmentId: f.departmentId || undefined,
      category: f.category || undefined, status: f.status,
    });
    return { f, rows };
  };

  router.get('/rekap', requireLevel(3), (req, res) => {
    const { f, rows } = load(req);
    const { page, offset } = pageParams(req.query.page);
    // status ikut di query string agar "Semua" ('') tidak berubah jadi APPROVED saat berpindah halaman.
    const qs = toQs({ ...f, status: f.status === '' ? '' : f.status }) + (f.status === '' ? '&status=' : '');
    res.view('report', {
      title: 'Rekap Lembur', f, summary: summarize(rows), total: rows.length, page,
      rows: rows.slice(offset, offset + PAGE_SIZE),
      departments: listDepartments(db),
      base: '/rekap' + (qs || '?'), csvHref: '/rekap.csv' + (qs || ''),
      formatHours,
    });
  });

  router.get('/rekap.csv', requireLevel(3), (req, res) => {
    const { f, rows } = load(req);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="rekap-lembur-${f.from}-${f.to}.csv"`);
    res.send(toCsv(rows));
  });

  return router;
}

module.exports = { createReportRoutes };

const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../errors');
const { createRequest, cancelRequest, saveRealization, checkWarnings, findConflicts } = require('../services/overtime');
const { getRequestDetail, listMyRequests } = require('../services/queries');
const { searchUsers, getUser } = require('../services/users');
const { formatDate, addDays, formatHours, durationMinutes, toRange } = require('../services/time');

const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError();
  return n;
};
const ACTION_LABELS = {
  'request.create': 'Pengajuan dibuat',
  'request.cancel': 'Pengajuan dibatalkan',
  'participant.manager_approve': 'Disetujui manager',
  'participant.manager_reject': 'Ditolak manager',
  'participant.hr_approve': 'Disetujui HR',
  'participant.hr_reject': 'Ditolak HR',
  'participant.realize': 'Realisasi diisi',
  'participant.skip_manager': 'Tahap manager dilewati',
};
const str = (v) => (typeof v === 'string' ? v : '');

function readForm(body) {
  const memberIds = [].concat(body.memberIds || []).map(Number).filter(Number.isInteger);
  return {
    type: body.type === 'GROUP' ? 'GROUP' : 'PERSONAL',
    workDate: str(body.workDate),
    startTime: str(body.startTime),
    endTime: str(body.endTime),
    activity: str(body.activity),
    memberIds,
  };
}

function createRequestRoutes(db) {
  const router = express.Router();
  const today = () => formatDate(new Date());

  const formView = (res, form, errors = [], status = 200) => {
    const members = form.memberIds.map((id) => getUser(db, id)).filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name }));
    res.view('request-new', {
      title: 'Ajukan Lembur', errors, form, members,
      minDate: addDays(today(), -3), maxDate: addDays(today(), 30),
    }, status);
  };

  router.get('/pengajuan/baru', requireLogin, (req, res) => {
    formView(res, { type: 'PERSONAL', workDate: today(), startTime: '', endTime: '', activity: '', memberIds: [] });
  });

  router.get('/pengajuan/cari-anggota', requireLogin, (req, res) => {
    const q = str(req.query.q).trim();
    const results = q.length >= 2 ? searchUsers(db, q, 10).filter((u) => u.id !== req.user.id) : [];
    if (req.get('HX-Request')) return res.render('partials/member-results', { results });
    return res.redirect('/pengajuan/baru');
  });

  router.post('/pengajuan/cek', requireLogin, (req, res) => {
    const f = readForm(req.body);
    const wanted = f.type === 'GROUP' ? [...new Set(f.memberIds)].slice(0, 50) : [];
    const isActive = db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1');
    const ids = [...new Set([req.user.id, ...wanted.filter((id) => isActive.get(id))])];
    let conflicts = [];
    let warnings = [];
    try {
      const sched = { workDate: f.workDate, startTime: f.startTime, endTime: f.endTime };
      conflicts = findConflicts(db, ids, sched);
      warnings = checkWarnings(db, ids, sched);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
    }
    res.render('partials/warnings', { conflicts, warnings });
  });

  router.post('/pengajuan', requireLogin, (req, res) => {
    const f = readForm(req.body);
    try {
      const r = createRequest(db, req.user, f, new Date());
      const msg = `Pengajuan ${r.code} terkirim.`;
      req.session.flash = r.warnings.length
        ? { type: 'warning', message: `${msg} Peringatan: ${r.warnings.join('; ')}` }
        : { type: 'success', message: msg };
      return res.redirect(`/pengajuan/${r.id}`);
    } catch (e) {
      if (e instanceof ValidationError) return formView(res, f, e.errors, 422);
      throw e;
    }
  });

  router.get('/pengajuan', requireLogin, (req, res) => {
    const status = ['PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(req.query.status) ? req.query.status : '';
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const { rows, total } = listMyRequests(db, req.user.id, { status, page });
    res.view('request-list', { title: 'Pengajuan Saya', rows, total, page, status });
  });

  router.get('/pengajuan/:id', requireLogin, (req, res) => {
    const { request, participants, timeline } = getRequestDetail(db, req.user, idParam(req.params.id));
    const isRequester = request.requester_id === req.user.id;
    const canCancel = isRequester && request.status === 'PROCESSING'
      && !participants.some((p) => p.manager_decided_by || p.hr_decided_by);
    // Jendela waktu sama dengan saveRealization: setelah jam mulai rencana, sampai work_date + 7 hari.
    const now = new Date();
    const inWindow = now >= toRange(request.work_date, request.start_time, request.end_time).start
      && formatDate(now) <= addDays(request.work_date, 7);
    const canRealize = (p) => p.status === 'APPROVED' && request.status !== 'CANCELLED' && inWindow
      && (p.user_id === req.user.id || isRequester);
    res.view('request-detail', { title: request.code, request, participants, timeline, canCancel, canRealize, formatHours, durationMinutes, actionLabels: ACTION_LABELS });
  });

  router.post('/pengajuan/peserta/:pid/realisasi', requireLogin, (req, res) => {
    const pid = idParam(req.params.pid);
    const row = db.prepare('SELECT request_id FROM overtime_participants WHERE id = ?').get(pid);
    try {
      saveRealization(db, req.user, pid, { actualStart: str(req.body.actualStart), actualEnd: str(req.body.actualEnd) }, new Date());
      req.session.flash = { type: 'success', message: 'Realisasi disimpan.' };
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      req.session.flash = { type: 'error', message: e.errors.join(' ') };
    }
    res.redirect(row ? `/pengajuan/${row.request_id}` : '/pengajuan');
  });

  router.post('/pengajuan/:id/batal', requireLogin, (req, res) => {
    const id = idParam(req.params.id);
    try {
      cancelRequest(db, req.user, id);
      req.session.flash = { type: 'success', message: 'Pengajuan dibatalkan.' };
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      req.session.flash = { type: 'error', message: e.errors.join(' ') };
    }
    res.redirect(`/pengajuan/${id}`);
  });

  return router;
}

module.exports = { createRequestRoutes };

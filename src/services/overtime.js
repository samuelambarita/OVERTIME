const { tx } = require('../db');
const { ValidationError, ForbiddenError, NotFoundError } = require('../errors');
const { validateSchedule, toRange, overlaps, durationMinutes, weekBounds, addDays, nowIso, formatHours } = require('./time');
const { supervisorChain } = require('./users');
const { nearestManager, computeRequestStatus } = require('./approval');
const { notify } = require('./notifications');
const audit = require('./audit');

const ACTIVE_SQL = "p.status IN ('WAITING_MANAGER','WAITING_HR','APPROVED') AND r.status != 'CANCELLED'";
const DAY_LIMIT_MIN = 4 * 60;
const WEEK_LIMIT_MIN = 18 * 60;

function activeRowsBetween(db, userIds, from, to, excludeRequestId) {
  if (!userIds.length) return [];
  const marks = userIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT p.user_id, u.name, r.id AS request_id, r.work_date, r.start_time, r.end_time, p.actual_start, p.actual_end
     FROM overtime_participants p
     JOIN overtime_requests r ON r.id = p.request_id
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id IN (${marks}) AND ${ACTIVE_SQL} AND r.work_date BETWEEN ? AND ?
       AND r.id != ?`
  ).all(...userIds, from, to, excludeRequestId ?? -1);
}

function findConflicts(db, userIds, { workDate, startTime, endTime }, excludeRequestId = null) {
  const target = toRange(workDate, startTime, endTime);
  const rows = activeRowsBetween(db, userIds, addDays(workDate, -1), addDays(workDate, 1), excludeRequestId);
  const names = [];
  for (const row of rows) {
    if (overlaps(target, toRange(row.work_date, row.start_time, row.end_time)) && !names.includes(row.name)) {
      names.push(row.name);
    }
  }
  return names;
}

const realisedMinutes = (row) => (row.actual_start && row.actual_end
  ? durationMinutes(row.actual_start, row.actual_end)
  : durationMinutes(row.start_time, row.end_time));

function checkWarnings(db, userIds, { workDate, startTime, endTime }, excludeRequestId = null) {
  const { from, to } = weekBounds(workDate);
  const newMin = durationMinutes(startTime, endTime);
  const rows = activeRowsBetween(db, userIds, from, to, excludeRequestId);
  const warnings = [];
  for (const userId of userIds) {
    const mine = rows.filter((r) => r.user_id === userId);
    const name = mine.length ? mine[0].name : db.prepare('SELECT name FROM users WHERE id = ?').get(userId)?.name;
    if (!name) continue;
    const day = newMin + mine.filter((r) => r.work_date === workDate).reduce((s, r) => s + realisedMinutes(r), 0);
    const week = newMin + mine.reduce((s, r) => s + realisedMinutes(r), 0);
    if (day > DAY_LIMIT_MIN) warnings.push(`${name}: total ${formatHours(day)} jam pada ${workDate} (batas 4 jam/hari)`);
    if (week > WEEK_LIMIT_MIN) {
      warnings.push(`${name}: total ${formatHours(week)} jam pada minggu ${from} s.d. ${to} (batas 18 jam/minggu)`);
    }
  }
  return warnings;
}

function createRequest(db, actor, input, now = new Date()) {
  return tx(db, () => {
    const { type, workDate, startTime, endTime } = input;
    const errors = [];
    if (type !== 'PERSONAL' && type !== 'GROUP') errors.push('Jenis pengajuan tidak valid.');
    errors.push(...validateSchedule({ workDate, startTime, endTime }, now));
    const activity = typeof input.activity === 'string' ? input.activity.trim() : '';
    if (activity.length < 10 || activity.length > 2000) errors.push('Kegiatan wajib diisi (10–2000 karakter).');
    if (errors.length) throw new ValidationError(errors);

    let ids = [actor.id];
    if (type === 'GROUP') {
      const members = Array.isArray(input.memberIds) ? input.memberIds.map(Number) : [];
      ids = [...new Set([actor.id, ...members])];
      if (ids.length < 2) throw new ValidationError(['Pengajuan kelompok minimal 2 peserta.']);
      if (ids.length > 50) throw new ValidationError(['Pengajuan kelompok maksimal 50 peserta.']);
    }
    const getActive = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1');
    if (ids.some((id) => !Number.isInteger(id) || !getActive.get(id))) throw new ValidationError(['Peserta tidak valid.']);

    const sched = { workDate, startTime, endTime };
    const conflicts = findConflicts(db, ids, sched);
    if (conflicts.length) throw new ValidationError([`Jadwal bentrok dengan lembur lain: ${conflicts.join(', ')}.`]);
    const warnings = checkWarnings(db, ids, sched);

    const year = now.getFullYear();
    const seq = Number(db.prepare('SELECT COUNT(*) AS c FROM overtime_requests WHERE code LIKE ?').get(`LBR-${year}-%`).c) + 1;
    const code = `LBR-${year}-${String(seq).padStart(4, '0')}`;
    const ts = nowIso(now);

    const requestId = Number(db.prepare(
      `INSERT INTO overtime_requests (code, requester_id, type, work_date, start_time, end_time, activity, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?)`
    ).run(code, actor.id, type, workDate, startTime, endTime, activity, ts, ts).lastInsertRowid);

    const insertPart = db.prepare(
      'INSERT INTO overtime_participants (request_id, user_id, manager_approver_id, status) VALUES (?, ?, ?, ?)');
    const insertChain = db.prepare('INSERT INTO participant_chain (participant_id, user_id) VALUES (?, ?)');
    const statuses = [];
    const approvers = [];
    for (const userId of ids) {
      const chain = supervisorChain(db, userId);
      const mgr = nearestManager(chain);
      const status = mgr ? 'WAITING_MANAGER' : 'WAITING_HR';
      const pid = Number(insertPart.run(requestId, userId, mgr ? mgr.id : null, status).lastInsertRowid);
      for (const c of chain) insertChain.run(pid, c.id);
      statuses.push(status);
      if (mgr) {
        if (!approvers.includes(mgr.id)) approvers.push(mgr.id);
      } else {
        audit.log(db, actor.id, 'participant.skip_manager', 'request', requestId, { userId });
      }
    }
    db.prepare('UPDATE overtime_requests SET status = ? WHERE id = ?').run(computeRequestStatus(statuses), requestId);

    for (const approverId of approvers) {
      notify(db, approverId, `Pengajuan lembur ${code} menunggu persetujuan Anda.`, '/persetujuan');
    }
    for (const userId of ids) {
      if (userId !== actor.id) notify(db, userId, `${actor.name} mengajak Anda lembur (${code}).`, `/pengajuan/${requestId}`);
    }
    audit.log(db, actor.id, 'request.create', 'request', requestId, { code, type, participants: ids.length });
    return { id: requestId, code, warnings };
  });
}

function cancelRequest(db, actor, requestId) {
  return tx(db, () => {
    const req = db.prepare('SELECT id, code, requester_id, status FROM overtime_requests WHERE id = ?').get(requestId);
    if (!req) throw new NotFoundError();
    if (req.requester_id !== actor.id) throw new ForbiddenError();
    const decided = db.prepare(
      'SELECT COUNT(*) AS c FROM overtime_participants WHERE request_id = ? AND (manager_decided_at IS NOT NULL OR hr_decided_at IS NOT NULL)'
    ).get(requestId).c;
    if (req.status !== 'PROCESSING' || Number(decided) > 0) {
      throw new ValidationError(['Pengajuan tidak bisa dibatalkan karena sudah ada keputusan.']);
    }
    db.prepare("UPDATE overtime_requests SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(nowIso(), requestId);
    audit.log(db, actor.id, 'request.cancel', 'request', requestId, { code: req.code });
  });
}

module.exports = { findConflicts, checkWarnings, createRequest, cancelRequest };

const { ForbiddenError, NotFoundError } = require('../errors');
const { pageParams } = require('./paging');
const { durationMinutes, formatDate } = require('./time');
const { checkWarnings } = require('./overtime');

const STATUS_LABELS = {
  PROCESSING: 'Diproses',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
  WAITING_MANAGER: 'Menunggu Manager',
  WAITING_HR: 'Menunggu HR',
};

// Peserta yang request-nya dibatalkan tetap berstatus WAITING_*; selalu dikecualikan dari antrean.
const NOT_CANCELLED = "r.status <> 'CANCELLED'";

function getRequestDetail(db, actor, id) {
  const request = db.prepare(
    `SELECT r.*, u.name AS requester_name FROM overtime_requests r
     JOIN users u ON u.id = r.requester_id WHERE r.id = ?`
  ).get(Number(id));
  if (!request) throw new NotFoundError();
  const participants = db.prepare(
    `SELECT p.*, u.name, u.username, d.name AS department, d.category,
            mu.name AS manager_decided_by_name, hu.name AS hr_decided_by_name
     FROM overtime_participants p
     JOIN users u ON u.id = p.user_id
     JOIN departments d ON d.id = u.department_id
     LEFT JOIN users mu ON mu.id = p.manager_decided_by
     LEFT JOIN users hu ON hu.id = p.hr_decided_by
     WHERE p.request_id = ? ORDER BY u.name, p.id`
  ).all(request.id);
  let allowed = request.requester_id === actor.id || actor.level >= 5
    || participants.some((p) => p.user_id === actor.id);
  if (!allowed) {
    allowed = Boolean(db.prepare(
      `SELECT 1 FROM participant_chain c JOIN overtime_participants p ON p.id = c.participant_id
       WHERE p.request_id = ? AND c.user_id = ? LIMIT 1`
    ).get(request.id, actor.id));
  }
  if (!allowed) throw new ForbiddenError();
  const timeline = db.prepare(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, a.actor_id, u.name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE (a.entity = 'request' AND a.entity_id = ?)
        OR (a.entity = 'participant' AND a.entity_id IN (SELECT id FROM overtime_participants WHERE request_id = ?))
     ORDER BY a.created_at, a.id`
  ).all(request.id, request.id);
  return { request, participants, timeline };
}

function listMyRequests(db, userId, { status, page = 1 } = {}) {
  const { limit, offset } = pageParams(page);
  const where = ['(r.requester_id = @uid OR EXISTS (SELECT 1 FROM overtime_participants p WHERE p.request_id = r.id AND p.user_id = @uid))'];
  const params = { uid: userId };
  if (status) {
    where.push('r.status = @status');
    params.status = status;
  }
  const w = where.join(' AND ');
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM overtime_requests r WHERE ${w}`).get(params).c);
  const rows = db.prepare(
    `SELECT r.*, u.name AS requester_name,
            (SELECT COUNT(*) FROM overtime_participants p WHERE p.request_id = r.id) AS participant_count,
            (SELECT p.status FROM overtime_participants p WHERE p.request_id = r.id AND p.user_id = @uid) AS my_status
     FROM overtime_requests r JOIN users u ON u.id = r.requester_id
     WHERE ${w} ORDER BY r.created_at DESC, r.id DESC LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });
  return { rows, total };
}

const QUEUE_SELECT = `SELECT p.id, p.request_id, p.user_id, p.status, p.manager_approver_id,
       r.code, r.work_date, r.start_time, r.end_time, r.activity, r.requester_id,
       ru.name AS requester_name, u.name, u.username, d.name AS department, d.category
     FROM overtime_participants p
     JOIN overtime_requests r ON r.id = p.request_id
     JOIN users ru ON ru.id = r.requester_id
     JOIN users u ON u.id = p.user_id
     JOIN departments d ON d.id = u.department_id`;

function managerWhere(scope) {
  const base = `p.status = 'WAITING_MANAGER' AND ${NOT_CANCELLED} AND p.user_id <> @aid`;
  return scope === 'team'
    ? `${base} AND EXISTS (SELECT 1 FROM participant_chain c WHERE c.participant_id = p.id AND c.user_id = @aid)`
    : `${base} AND p.manager_approver_id = @aid`;
}

function listManagerQueue(db, actor, { scope = 'mine', page = 1 } = {}) {
  const { limit, offset } = pageParams(page);
  const w = managerWhere(scope === 'team' ? 'team' : 'mine');
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS c FROM overtime_participants p JOIN overtime_requests r ON r.id = p.request_id WHERE ${w}`
  ).get({ aid: actor.id }).c);
  const rows = db.prepare(`${QUEUE_SELECT} WHERE ${w} ORDER BY r.work_date, r.start_time, p.id LIMIT @limit OFFSET @offset`)
    .all({ aid: actor.id, limit, offset });
  for (const row of rows) {
    row.warnings = checkWarnings(db, [row.user_id],
      { workDate: row.work_date, startTime: row.start_time, endTime: row.end_time }, row.request_id);
  }
  return { rows, total };
}

function listHrQueue(db, actor, { departmentId, category, page = 1 } = {}) {
  const { limit, offset } = pageParams(page);
  const where = ["p.status = 'WAITING_HR'", NOT_CANCELLED, 'p.user_id <> @aid'];
  const params = { aid: actor.id };
  if (departmentId) { where.push('u.department_id = @dep'); params.dep = Number(departmentId); }
  if (category) { where.push('d.category = @cat'); params.cat = category; }
  const w = where.join(' AND ');
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS c FROM overtime_participants p
     JOIN overtime_requests r ON r.id = p.request_id
     JOIN users u ON u.id = p.user_id JOIN departments d ON d.id = u.department_id WHERE ${w}`
  ).get(params).c);
  const rows = db.prepare(`${QUEUE_SELECT} WHERE ${w} ORDER BY r.work_date, r.start_time, p.id LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  return { rows, total };
}

function pendingCounts(db, actor) {
  let manager = 0;
  let hr = 0;
  if (actor.level >= 3) {
    manager = Number(db.prepare(
      `SELECT COUNT(*) AS c FROM overtime_participants p JOIN overtime_requests r ON r.id = p.request_id WHERE ${managerWhere('team')}`
    ).get({ aid: actor.id }).c);
  }
  if (actor.level >= 5) {
    hr = Number(db.prepare(
      `SELECT COUNT(*) AS c FROM overtime_participants p JOIN overtime_requests r ON r.id = p.request_id
       WHERE p.status = 'WAITING_HR' AND ${NOT_CANCELLED} AND p.user_id <> ?`
    ).get(actor.id).c);
  }
  return { manager, hr };
}

function dashboardData(db, actor, now = new Date()) {
  const month = formatDate(now).slice(0, 7);
  const parts = db.prepare(
    `SELECT r.start_time, r.end_time, p.actual_start, p.actual_end
     FROM overtime_participants p JOIN overtime_requests r ON r.id = p.request_id
     WHERE p.user_id = ? AND p.status = 'APPROVED' AND ${NOT_CANCELLED} AND substr(r.work_date, 1, 7) = ?`
  ).all(actor.id, month);
  let monthMinutes = 0;
  for (const p of parts) {
    monthMinutes += p.actual_start && p.actual_end
      ? durationMinutes(p.actual_start, p.actual_end)
      : durationMinutes(p.start_time, p.end_time);
  }
  const recent = listMyRequests(db, actor.id, { page: 1 }).rows.slice(0, 5);
  return { monthMinutes, recent, pending: pendingCounts(db, actor) };
}

module.exports = {
  STATUS_LABELS, getRequestDetail, listMyRequests, listManagerQueue, listHrQueue, pendingCounts, dashboardData,
};

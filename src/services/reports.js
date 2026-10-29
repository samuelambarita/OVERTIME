const { ForbiddenError } = require('../errors');
const { durationMinutes } = require('./time');
const { STATUS_LABELS } = require('./queries');

const CSV_HEADER = 'Kode;Tanggal;Nama;Username;Departemen;Kategori;Mulai;Selesai;Durasi (jam);Sumber;Status;Kegiatan';

function recap(db, actor, { from, to, departmentId, category, status = 'APPROVED' } = {}) {
  if (actor.level < 3) throw new ForbiddenError();
  const where = ["r.status <> 'CANCELLED'"];
  const params = {};
  if (from) { where.push('r.work_date >= @from'); params.from = from; }
  if (to) { where.push('r.work_date <= @to'); params.to = to; }
  if (departmentId) { where.push('u.department_id = @dep'); params.dep = Number(departmentId); }
  if (category) { where.push('d.category = @cat'); params.cat = category; }
  if (status && status !== 'ALL') { where.push('p.status = @status'); params.status = status; }
  if (actor.level < 5) {
    where.push('EXISTS (SELECT 1 FROM participant_chain c WHERE c.participant_id = p.id AND c.user_id = @aid)');
    params.aid = actor.id;
  }
  const rows = db.prepare(
    `SELECT r.code, r.work_date, r.start_time, r.end_time, r.activity, u.name, u.username,
            d.name AS department, d.category, p.status, p.actual_start, p.actual_end
     FROM overtime_participants p
     JOIN overtime_requests r ON r.id = p.request_id
     JOIN users u ON u.id = p.user_id
     JOIN departments d ON d.id = u.department_id
     WHERE ${where.join(' AND ')} ORDER BY r.work_date, r.code, u.name`
  ).all(params);
  return rows.map((x) => {
    const real = Boolean(x.actual_start && x.actual_end);
    const start = real ? x.actual_start : x.start_time;
    const end = real ? x.actual_end : x.end_time;
    return {
      code: x.code, workDate: x.work_date, name: x.name, username: x.username,
      department: x.department, category: x.category, start, end,
      minutes: durationMinutes(start, end), source: real ? 'Realisasi' : 'Rencana',
      status: x.status, activity: x.activity,
    };
  });
}

function summarize(rows) {
  let totalMinutes = 0;
  const users = new Map();
  const depts = new Map();
  for (const r of rows) {
    if (r.status !== 'APPROVED') continue;
    totalMinutes += r.minutes;
    if (!users.has(r.username)) users.set(r.username, { name: r.name, department: r.department, minutes: 0 });
    users.get(r.username).minutes += r.minutes;
    if (!depts.has(r.department)) depts.set(r.department, { department: r.department, category: r.category, minutes: 0 });
    depts.get(r.department).minutes += r.minutes;
  }
  const byMinutes = (a, b) => b.minutes - a.minutes;
  return { totalMinutes, perUser: [...users.values()].sort(byMinutes), perDepartment: [...depts.values()].sort(byMinutes) };
}

function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function hoursComma(minutes) {
  return (minutes / 60).toFixed(2).replace('.', ',');
}

function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([
      r.code, r.workDate, r.name, r.username, r.department,
      r.category === 'IT' ? 'IT' : 'Non-IT', r.start, r.end, hoursComma(r.minutes),
      r.source, STATUS_LABELS[r.status] || r.status, r.activity,
    ].map(csvField).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

module.exports = { recap, summarize, toCsv };

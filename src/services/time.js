const { ValidationError } = require('../errors');

const FORMAT_MSG = 'Format tanggal/jam tidak valid.';
const pad = (n) => String(n).padStart(2, '0');

function parseHM(s) {
  const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null;
  if (!m) throw new ValidationError([FORMAT_MSG]);
  return Number(m[1]) * 60 + Number(m[2]);
}

function durationMinutes(startHM, endHM) {
  return (parseHM(endHM) - parseHM(startHM) + 1440) % 1440;
}

function parseDate(dateStr) {
  const m = typeof dateStr === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  if (!d) throw new ValidationError([FORMAT_MSG]);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function nowIso(d = new Date()) {
  return `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toRange(workDate, startHM, endHM) {
  const base = parseDate(workDate);
  if (!base) throw new ValidationError([FORMAT_MSG]);
  const s = parseHM(startHM);
  const e = parseHM(endHM);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(s / 60), s % 60);
  const endDay = e <= s ? base.getDate() + 1 : base.getDate();
  const end = new Date(base.getFullYear(), base.getMonth(), endDay, Math.floor(e / 60), e % 60);
  return { start, end };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function weekBounds(dateStr) {
  const d = parseDate(dateStr);
  if (!d) throw new ValidationError([FORMAT_MSG]);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  const from = addDays(dateStr, -offset);
  return { from, to: addDays(from, 6) };
}

// 300 -> '5', 270 -> '4,5' (1 desimal, koma, tanpa ',0')
function formatHours(minutes) {
  return String(Math.round(minutes / 6) / 10).replace('.', ',');
}

function validateSchedule({ workDate, startTime, endTime } = {}, now = new Date()) {
  let dur;
  try {
    if (!parseDate(workDate)) return [FORMAT_MSG];
    parseHM(startTime);
    parseHM(endTime);
    dur = durationMinutes(startTime, endTime);
  } catch (e) {
    if (e instanceof ValidationError) return [FORMAT_MSG];
    throw e;
  }
  const errors = [];
  const today = formatDate(now);
  if (workDate < addDays(today, -3)) errors.push('Tanggal lembur paling lambat 3 hari ke belakang.');
  if (workDate > addDays(today, 30)) errors.push('Tanggal lembur paling jauh 30 hari ke depan.');
  if (dur === 0) errors.push('Jam selesai tidak boleh sama dengan jam mulai.');
  else if (dur < 30) errors.push('Durasi lembur minimal 30 menit.');
  else if (dur > 720) errors.push('Durasi lembur maksimal 12 jam.');
  return errors;
}

module.exports = { parseHM, durationMinutes, toRange, overlaps, formatDate, addDays, nowIso, weekBounds, validateSchedule, formatHours };

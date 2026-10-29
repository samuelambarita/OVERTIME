const { nowIso } = require('./time');
const { pageParams } = require('./paging');

// Tidak membuka transaksi sendiri; ikut transaksi pemanggil bila ada.
function log(db, actorId, action, entity, entityId = null, detail = null) {
  db.prepare(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(actorId ?? null, action, entity, entityId ?? null, detail == null ? null : JSON.stringify(detail), nowIso());
}

const prefix = (q) => `${String(q).replace(/[\\%_]/g, '\\$&')}%`;

// Filter action = awalan (prefix) yang di-escape; terbaru lebih dulu.
function listAudit(db, { action, page = 1 } = {}) {
  const where = action ? "WHERE a.action LIKE @a ESCAPE '\\'" : '';
  const params = action ? { a: prefix(action) } : {};
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM audit_log a ${where}`).get(params).c);
  const { limit, offset } = pageParams(page);
  const rows = db.prepare(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, a.actor_id, u.name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${where}
     ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(params);
  return { rows, total };
}

module.exports = { log, listAudit };

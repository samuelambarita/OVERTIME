const { nowIso } = require('./time');

// Tidak membuka transaksi sendiri; ikut transaksi pemanggil bila ada.
function log(db, actorId, action, entity, entityId = null, detail = null) {
  db.prepare(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(actorId ?? null, action, entity, entityId ?? null, detail == null ? null : JSON.stringify(detail), nowIso());
}

module.exports = { log };

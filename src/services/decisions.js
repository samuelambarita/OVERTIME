const { tx } = require('../db');
const { ValidationError } = require('../errors');
const { nowIso } = require('./time');
const { canDecideManager, canDecideHr, computeRequestStatus } = require('./approval');
const { notify } = require('./notifications');
const audit = require('./audit');

const STAGES = {
  manager: {
    from: 'WAITING_MANAGER',
    approveTo: 'WAITING_HR',
    cols: { by: 'manager_decided_by', at: 'manager_decided_at', note: 'manager_note' },
    can: (db, actor, p) => canDecideManager(db, actor, p),
    approveMsg: (code) => `Lembur ${code} disetujui manager, menunggu HR.`,
    rejectMsg: (code, note) => `Lembur ${code} ditolak manager: ${note}`,
    auditPrefix: 'participant.manager_',
  },
  hr: {
    from: 'WAITING_HR',
    approveTo: 'APPROVED',
    cols: { by: 'hr_decided_by', at: 'hr_decided_at', note: 'hr_note' },
    can: (db, actor, p) => canDecideHr(actor, p),
    approveMsg: (code) => `Lembur ${code} disetujui HR.`,
    rejectMsg: (code, note) => `Lembur ${code} ditolak HR: ${note}`,
    auditPrefix: 'participant.hr_',
  },
};

function decide(db, stage, actor, participantIds, decision, note, now) {
  const cfg = STAGES[stage];
  const approve = decision === 'APPROVE';
  if (!approve && decision !== 'REJECT') throw new ValidationError(['Keputusan tidak valid.']);
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (!approve && !cleanNote) throw new ValidationError(['Catatan wajib diisi saat menolak.']);

  return tx(db, () => {
    const ids = [...new Set((Array.isArray(participantIds) ? participantIds : []).map(Number))];
    const getPart = db.prepare(
      `SELECT p.*, r.status AS request_status FROM overtime_participants p
       JOIN overtime_requests r ON r.id = p.request_id WHERE p.id = ?`);
    const update = db.prepare(
      `UPDATE overtime_participants SET status = ?, ${cfg.cols.by} = ?, ${cfg.cols.at} = ?, ${cfg.cols.note} = ?
       WHERE id = ? AND status = ?`);
    const ts = nowIso(now);
    const newStatus = approve ? cfg.approveTo : 'REJECTED';
    let done = 0;
    let skipped = 0;
    const touched = new Map(); // requestId -> user ids of decided participants

    for (const id of ids) {
      const p = Number.isInteger(id) ? getPart.get(id) : undefined;
      if (!p || p.request_status === 'CANCELLED' || !cfg.can(db, actor, p)) { skipped++; continue; }
      const res = update.run(newStatus, actor.id, ts, cleanNote || null, id, cfg.from);
      if (Number(res.changes) === 0) { skipped++; continue; }
      done++;
      if (!touched.has(p.request_id)) touched.set(p.request_id, []);
      touched.get(p.request_id).push(p.user_id);
      audit.log(db, actor.id, `${cfg.auditPrefix}${approve ? 'approve' : 'reject'}`, 'participant', id,
        cleanNote ? { note: cleanNote } : null);
    }

    for (const [requestId, userIds] of touched) {
      const req = db.prepare('SELECT code, requester_id FROM overtime_requests WHERE id = ?').get(requestId);
      const statuses = db.prepare('SELECT status FROM overtime_participants WHERE request_id = ?').all(requestId).map((r) => r.status);
      db.prepare('UPDATE overtime_requests SET status = ?, updated_at = ? WHERE id = ?')
        .run(computeRequestStatus(statuses), ts, requestId);
      const message = approve ? cfg.approveMsg(req.code) : cfg.rejectMsg(req.code, cleanNote);
      for (const userId of new Set([...userIds, req.requester_id])) {
        notify(db, userId, message, `/pengajuan/${requestId}`, now);
      }
    }
    return { done, skipped };
  });
}

function decideManager(db, actor, participantIds, decision, note = '', now = new Date()) {
  return decide(db, 'manager', actor, participantIds, decision, note, now);
}

function decideHr(db, actor, participantIds, decision, note = '', now = new Date()) {
  return decide(db, 'hr', actor, participantIds, decision, note, now);
}

module.exports = { decideManager, decideHr };

const { MIN_MANAGER, MIN_HR } = require('./levels');

function nearestManager(chain) {
  return chain.find((u) => u.is_active && u.level >= MIN_MANAGER) || null;
}

function canDecideManager(db, actor, participant) {
  if (!actor.is_active || actor.level < MIN_MANAGER) return false;
  if (actor.id === participant.user_id) return false;
  if (participant.status !== 'WAITING_MANAGER') return false;
  const row = db.prepare('SELECT 1 FROM participant_chain WHERE participant_id = ? AND user_id = ?').get(participant.id, actor.id);
  return !!row;
}

function canDecideHr(actor, participant) {
  return !!actor.is_active && actor.level >= MIN_HR
    && actor.id !== participant.user_id
    && participant.status === 'WAITING_HR';
}

function computeRequestStatus(statuses) {
  if (statuses.some((s) => s.startsWith('WAITING_'))) return 'PROCESSING';
  if (statuses.every((s) => s === 'REJECTED')) return 'REJECTED';
  return 'APPROVED';
}

module.exports = { nearestManager, canDecideManager, canDecideHr, computeRequestStatus };

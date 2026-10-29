const { nowIso } = require('./time');
const { pageParams } = require('./paging');

function notify(db, userId, message, link = null) {
  db.prepare('INSERT INTO notifications (user_id, message, link, read_at, created_at) VALUES (?, ?, ?, NULL, ?)')
    .run(userId, message, link, nowIso());
}

function listNotifications(db, userId, page = 1) {
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?').get(userId).c);
  const { limit, offset } = pageParams(page);
  const rows = db.prepare(
    'SELECT id, user_id, message, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(userId, limit, offset);
  return { rows, total };
}

function unreadCount(db, userId) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).c);
}

function markRead(db, userId, id) {
  if (id === 'all') {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), userId);
  } else {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
      .run(nowIso(), Number(id), userId);
  }
}

module.exports = { notify, listNotifications, unreadCount, markRead };

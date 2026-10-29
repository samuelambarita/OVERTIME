const session = require('express-session');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  _expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    const t = exp ? new Date(exp).getTime() : NaN;
    return Number.isFinite(t) ? t : Date.now() + DEFAULT_TTL_MS;
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.db.prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      ).run(sid, JSON.stringify(sess), this._expiry(sess));
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(this._expiry(sess), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = { SqliteStore };

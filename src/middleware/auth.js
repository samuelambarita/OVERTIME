const { ForbiddenError } = require('../errors');
const { getUser } = require('../services/users');
const { STATUS_LABELS, pendingCounts } = require('../services/queries');
const { unreadCount } = require('../services/notifications');
const { LEVEL_NAMES } = require('../services/levels');

// Memuat user dari sesi; user hilang/nonaktif => sesi dibuang (dianggap belum login).
function loadUser(db) {
  return (req, res, next) => {
    res.locals.LEVEL_NAMES = LEVEL_NAMES;
    res.locals.STATUS_LABELS = STATUS_LABELS;
    res.locals.user = null;
    res.locals.unread = 0;
    res.locals.pending = { manager: 0, hr: 0 };
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;

    const id = req.session.userId;
    if (!id) return next();
    const user = getUser(db, id);
    if (!user || !user.is_active) {
      // regenerate membuang sesi lama dan memberi sesi baru (csrf tetap tersedia)
      return req.session.regenerate((err) => next(err));
    }
    req.user = user;
    res.locals.user = user;
    res.locals.unread = unreadCount(db, user.id);
    res.locals.pending = pendingCounts(db, user);
    return next();
  };
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.must_change_password && req.path !== '/ganti-password' && req.path !== '/logout') {
    return res.redirect('/ganti-password');
  }
  return next();
}

const requireLevel = (min) => (req, res, next) => (
  req.user && req.user.level >= min ? next() : next(new ForbiddenError())
);

function requireAdmin(req, res, next) {
  return req.user && req.user.is_admin ? next() : next(new ForbiddenError());
}

module.exports = { loadUser, requireLogin, requireLevel, requireAdmin };

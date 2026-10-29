const crypto = require('node:crypto');
const { ForbiddenError } = require('../errors');

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  const token = req.session.csrf;
  res.locals.csrfToken = token;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (typeof sent === 'string' && sent.length === token.length
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) return next();
  return next(new ForbiddenError('Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.'));
}

module.exports = { csrf };

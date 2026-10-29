const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { SqliteStore } = require('./db/session-store');
const { security } = require('./middleware/security');
const { csrf } = require('./middleware/csrf');
const { loadUser } = require('./middleware/auth');
const { createAuthRoutes } = require('./routes/auth');
const { createDashboardRoutes } = require('./routes/dashboard');
const { createRequestRoutes } = require('./routes/requests');
const { createApprovalRoutes } = require('./routes/approvals');
const { createNotificationRoutes } = require('./routes/notifications');
const { createReportRoutes } = require('./routes/reports');
const { createAdminRoutes } = require('./routes/admin');
const { ForbiddenError,NotFoundError } = require('./errors');

const EIGHT_HOURS = 8 * 60 * 60 * 1000;

// res.view(name, locals, status): render halaman `name` lalu bungkus dengan layout.ejs.
function viewHelper(req, res, next) {
  res.view = (name, locals = {}, status = 200) => {
    res.render(name, locals, (err, body) => {
      if (err) return next(err);
      return res.status(status).render('layout', { title: locals.title || '', ...locals, body });
    });
  };
  next();
}

// extend(app): hook opsional (dipakai test) untuk menambah rute sebelum handler 404.
function createApp({ db, sessionSecret, secureCookie = false, extend }) {
  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(viewHelper);
  app.use(security);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    name: 'lembur.sid',
    secret: sessionSecret,
    store: new SqliteStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: EIGHT_HOURS },
  }));
  app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
  app.use(loadUser(db));
  app.use(csrf);

  app.use(createAuthRoutes(db));

  app.use(createDashboardRoutes(db));
  app.use(createRequestRoutes(db));
  app.use(createApprovalRoutes(db));
  app.use(createNotificationRoutes(db));
  app.use(createReportRoutes(db));
  app.use(createAdminRoutes(db));

  if (extend) extend(app);

  app.use((req, res, next) => next(new NotFoundError('Halaman tidak ditemukan.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = 500;
    let message = 'Terjadi kesalahan pada server.';
    if (err instanceof ForbiddenError) { status = 403; message = err.message; }
    else if (err instanceof NotFoundError) { status = 404; message = err.message; }
    else {
      const s = err && (err.status || err.statusCode);
      if (s >= 400 && s < 500) { status = s; message = 'Permintaan tidak valid.'; }
      else console.error(err);
    }
    // Jangan pernah biarkan finalhandler menampilkan stack trace.
    const fallback = () => { if (!res.headersSent) res.status(status).type('text').send(message); };
    if (typeof res.view !== 'function') return fallback();
    res.render('error', { status, message }, (e1, body) => {
      if (e1) return fallback();
      return res.status(status).render('layout', { title: 'Kesalahan', status, message, body }, (e2, html) => {
        if (e2) return fallback();
        return res.send(html);
      });
    });
  });

  return app;
}

module.exports = { createApp };

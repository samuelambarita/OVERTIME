const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { SqliteStore } = require('./db/session-store');
const { security } = require('./middleware/security');
const { csrf } = require('./middleware/csrf');
const { loadUser, requireLogin } = require('./middleware/auth');
const { createAuthRoutes } = require('./routes/auth');
const { ForbiddenError, NotFoundError } = require('./errors');

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

function createApp({ db, sessionSecret, secureCookie = false }) {
  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(security);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    name: 'lembur.sid',
    secret: sessionSecret,
    store: new SqliteStore(db),
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: EIGHT_HOURS },
  }));
  app.use(viewHelper);
  app.use(loadUser(db));
  app.use(csrf);

  app.use(createAuthRoutes(db));

  app.get('/', requireLogin, (req, res) => {
    // Placeholder; Task 9 menggantikan dengan dashboard sebenarnya.
    res.view('dashboard', { title: 'Beranda' });
  });

  app.use((req, res, next) => next(new NotFoundError('Halaman tidak ditemukan.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = 500;
    let message = 'Terjadi kesalahan pada server.';
    if (err instanceof ForbiddenError) { status = 403; message = err.message; }
    else if (err instanceof NotFoundError) { status = 404; message = err.message; }
    else if (err && err.status >= 400 && err.status < 500) { status = err.status; message = 'Permintaan tidak valid.'; }
    else console.error(err);
    if (res.headersSent) return;
    res.view('error', { title: 'Kesalahan', status, message }, status);
  });

  return app;
}

module.exports = { createApp };

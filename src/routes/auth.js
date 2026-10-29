const express = require('express');
const { authenticate, changePassword } = require('../services/users');
const { createLoginLimiter } = require('../middleware/rate-limit');
const { requireLogin } = require('../middleware/auth');
const { ValidationError } = require('../errors');

function createAuthRoutes(db) {
  const router = express.Router();
  const limiter = createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    return res.view('login', { title: 'Masuk', errors: [], username: '' });
  });

  router.post('/login', (req, res, next) => {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${username.toLowerCase()}|${req.ip}`;
    if (limiter.isBlocked(key)) {
      return res.view('login', {
        title: 'Masuk', username, errors: ['Terlalu banyak percobaan. Coba lagi dalam 15 menit.'],
      }, 429);
    }
    const user = authenticate(db, username, password);
    if (!user) {
      limiter.fail(key);
      return res.view('login', { title: 'Masuk', username, errors: ['Username atau password salah.'] });
    }
    limiter.reset(key);
    return req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      return req.session.save((err2) => (err2 ? next(err2) : res.redirect('/')));
    });
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('lembur.sid');
      return res.redirect('/login');
    });
  });

  router.get('/ganti-password', requireLogin, (req, res) => {
    res.view('change-password', { title: 'Ganti Password', errors: [] });
  });

  router.post('/ganti-password', requireLogin, (req, res, next) => {
    const { old_password: oldPw, new_password: newPw, confirm_password: confirm } = req.body;
    try {
      if (newPw !== confirm) throw new ValidationError(['Konfirmasi password tidak cocok.']);
      changePassword(db, req.user.id, oldPw, newPw);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.view('change-password', { title: 'Ganti Password', errors: err.errors }, 422);
      }
      return next(err);
    }
    req.session.flash = { type: 'success', message: 'Password berhasil diganti.' };
    return res.redirect('/');
  });

  return router;
}

module.exports = { createAuthRoutes };

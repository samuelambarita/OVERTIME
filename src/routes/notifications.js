const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { listNotifications, markRead } = require('../services/notifications');

function createNotificationRoutes(db) {
  const router = express.Router();

  router.get('/notifikasi', requireLogin, (req, res) => {
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const { rows, total } = listNotifications(db, req.user.id, page);
    res.view('notifications', { title: 'Notifikasi', rows, total, page });
  });

  router.post('/notifikasi/baca-semua', requireLogin, (req, res) => {
    markRead(db, req.user.id, 'all');
    res.redirect('/notifikasi');
  });

  router.post('/notifikasi/:id/baca', requireLogin, (req, res) => {
    markRead(db, req.user.id, req.params.id);
    res.redirect('/notifikasi');
  });
  return router;
}

module.exports = { createNotificationRoutes };

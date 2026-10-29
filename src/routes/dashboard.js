const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { dashboardData } = require('../services/queries');
const { formatHours } = require('../services/time');

function createDashboardRoutes(db) {
  const router = express.Router();
  router.get('/', requireLogin, (req, res) => {
    const data = dashboardData(db, req.user, new Date());
    res.view('dashboard', { title: 'Beranda', monthHours: formatHours(data.monthMinutes), recent: data.recent });
  });
  return router;
}

module.exports = { createDashboardRoutes };

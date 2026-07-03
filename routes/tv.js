'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const settings = require('../helpers/settings');
const { getAllAppointments } = require('../db');

const router = express.Router();

router.use(requireAuth, requireAdmin);

const DEFAULT_PLAYLIST_ID = 'PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth';

router.get('/', (req, res) => {
  const playlistId = settings.get('tv_board_playlist_id') || DEFAULT_PLAYLIST_ID;
  res.render('admin/tv-board', { playlistId });
});

router.get('/data.json', async (req, res) => {
  try {
    const appointments = await getAllAppointments();
    const items = appointments.slice(0, 12).map(a => ({
      id: a.id,
      customer: a.customer,
      service: a.service,
      date: a.date,
      time: a.time,
      status: a.status,
      createdAt: a.createdAt,
    }));
    res.json({ appointments: items });
  } catch (e) {
    console.error('GET /admin/tv/data.json error:', e.message);
    res.status(500).json({ appointments: [] });
  }
});

module.exports = router;

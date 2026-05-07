'use strict';
const express = require('express');
const { getAllEvents, getUserEventRegistrations } = require('../db');

const router = express.Router();

router.get('/eventos', async (req, res) => {
  const events = await getAllEvents();
  const registrations = req.userId ? await getUserEventRegistrations(req.userId) : {};
  res.render('events', { events, registrations });
});

module.exports = router;

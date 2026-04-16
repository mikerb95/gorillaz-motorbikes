'use strict';
const express = require('express');
const { getAllEvents } = require('../db');

const router = express.Router();

router.get('/eventos', async (req, res) => {
  const events = await getAllEvents();
  res.render('events', { events });
});

module.exports = router;

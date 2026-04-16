'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createJobApplication } = require('../db');

const router = express.Router();

router.get('/trabaja', (req, res) => res.render('jobs', { status: req.query.status || null }));

router.post('/trabaja', async (req, res) => {
  const name       = (req.body.name       || '').toString().trim();
  const email      = (req.body.email      || '').toString().trim().toLowerCase();
  const phone      = (req.body.phone      || '').toString().trim();
  const experience = (req.body.experience || '').toString().trim();
  const skills     = (req.body.skills     || '').toString().trim();
  const message    = (req.body.message    || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) return res.redirect('/trabaja?status=error');
  await createJobApplication({ id: uuidv4(), name, email, phone, experience, skills, message });
  res.redirect('/trabaja?status=ok');
});

module.exports = router;

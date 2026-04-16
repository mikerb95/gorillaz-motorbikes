'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const courses = require('../data/courses.json');
const { createEnrollment } = require('../db');
const { saveJSON } = require('../helpers/files');

const router = express.Router();

router.get('/cursos', (req, res) => res.render('courses', { list: courses }));

router.get('/cursos/:slug', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.render('course', { course, enrollStatus: req.query.status || null });
});

router.get('/cursos/:slug/inscripcion', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.redirect(`/cursos/${encodeURIComponent(req.params.slug)}#inscripcion`);
});

router.post('/cursos/:slug/inscripcion', async (req, res) => {
  const slug   = req.params.slug;
  const course = courses.find(c => c.slug === slug);
  if (!course) return res.status(404).render('404');
  const name  = (req.body.name  || '').toString().trim();
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const phone = (req.body.phone || '').toString().trim();
  const notes = (req.body.notes || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) {
    return res.redirect(`/cursos/${encodeURIComponent(slug)}?status=error#inscripcion`);
  }
  await createEnrollment({ id: uuidv4(), slug, courseTitle: course.title, name, email, phone, notes });
  res.redirect(`/cursos/${encodeURIComponent(slug)}?status=ok#inscripcion`);
});

module.exports = router;

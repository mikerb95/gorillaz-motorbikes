'use strict';
const express     = require('express');
const classesData = require('../data/classes.json');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/clases/:course/:topic', requireAuth, requireAdmin, (req, res) => {
  const { course, topic } = req.params;
  const courseObj = classesData[course];
  if (!courseObj) return res.status(404).render('404');
  const topicObj = (courseObj.topics || {})[topic];
  if (!topicObj) return res.status(404).render('404');
  res.render('classes/presentation', { courseKey: course, courseTitle: courseObj.title, topicKey: topic, topicTitle: topicObj.title, slides: topicObj.slides || [] });
});

module.exports = router;

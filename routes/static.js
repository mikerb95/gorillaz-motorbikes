'use strict';
const express = require('express');
const { GOOGLE_REVIEW_URL } = require('../config');
const faq = require('../data/faq');

const router = express.Router();

// /terminos, /privacidad y las demás políticas viven en routes/legal.js.

router.get('/licencia',   (req, res) => res.render('license', {}));
router.get('/mision',     (req, res) => res.render('mission'));
router.get('/vision',     (req, res) => res.render('vision'));
router.get('/faq',        (req, res) => res.render('faq', { faq }));
router.get('/resenas',    (req, res) => res.render('reviews', { googleReviewUrl: GOOGLE_REVIEW_URL }));

module.exports = router;

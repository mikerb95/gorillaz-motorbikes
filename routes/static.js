'use strict';
const express = require('express');
const { GOOGLE_REVIEW_URL } = require('../config');

const router = express.Router();

router.get('/privacidad', (req, res) => res.render('privacy', {}));
router.get('/licencia',   (req, res) => res.render('license', {}));
router.get('/terminos',   (req, res) => res.render('terms', {}));
router.get('/mision',     (req, res) => res.render('mission'));
router.get('/vision',     (req, res) => res.render('vision'));
router.get('/faq',        (req, res) => res.render('faq'));
router.get('/resenas',    (req, res) => res.render('reviews', { googleReviewUrl: GOOGLE_REVIEW_URL }));

module.exports = router;

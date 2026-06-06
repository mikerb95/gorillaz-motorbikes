'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { RECAPTCHA_SITE_KEY } = require('../config');
const catalog = require('../data/catalog');

const router = express.Router();

router.get('/', (req, res) => {
  const slidesDirWebp = path.join(__dirname, '..', 'images', 'slideshow', 'WEBP');
  const slidesDir     = path.join(__dirname, '..', 'images', 'slideshow');
  const allowed       = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  const readSlides    = (dir, urlPrefix) => {
    try {
      return fs.readdirSync(dir)
        .filter(f => allowed.has(path.extname(f).toLowerCase()))
        .sort()
        .map(f => `${urlPrefix}/${encodeURIComponent(f)}`);
    } catch { return []; }
  };
  let slides = readSlides(slidesDirWebp, '/images/slideshow/WEBP');
  if (!slides.length) slides = readSlides(slidesDir, '/images/slideshow');

  const flash            = req.query.flash || null;
  const newsletterStatus = flash === 'ok' ? 'ok' : flash === 'error' ? 'error' : flash === 'captcha' ? 'captcha' : null;

  const featuredProducts = catalog.products
    .filter(p => p.stock > 0)
    .sort((a, b) => b.discount - a.discount)
    .slice(0, 3);

  res.render('home', {
    slides,
    newsletterStatus,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    featuredProducts,
    title: 'Gorillaz Motorbikes | Taller de motos en Bogotá',
    description: 'Taller especializado de motos en Bogotá. Mecánica, pintura, escaneo computarizado y tecnomecánica. Agenda online en minutos.',
    canonicalPath: '/',
    bodyClass: 'page-home',
  });
});

module.exports = router;

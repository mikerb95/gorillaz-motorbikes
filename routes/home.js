'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { RECAPTCHA_SITE_KEY } = require('../config');
const catalog = require('../data/catalog');

const router = express.Router();

// Los slides son archivos estáticos que solo cambian al desplegar, así que
// listamos el directorio una vez al cargar el módulo (una vez por cold start)
// en lugar de hacer fs.readdirSync síncrono en cada visita a la home, que es
// la página de mayor tráfico y bloquearía el event loop en cada request.
const SLIDES = (() => {
  const allowed    = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  const readSlides = (dir, urlPrefix) => {
    try {
      return fs.readdirSync(dir)
        .filter(f => allowed.has(path.extname(f).toLowerCase()))
        .sort()
        .map(f => `${urlPrefix}/${encodeURIComponent(f)}`);
    } catch { return []; }
  };
  const webp = readSlides(path.join(__dirname, '..', 'images', 'slideshow', 'WEBP'), '/images/slideshow/WEBP');
  return webp.length ? webp : readSlides(path.join(__dirname, '..', 'images', 'slideshow'), '/images/slideshow');
})();

router.get('/', (req, res) => {
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

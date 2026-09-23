'use strict';
const express = require('express');
const { RECAPTCHA_SITE_KEY } = require('../config');
const { catalog } = require('../helpers/catalog');
const { loadPuntosConfig } = require('../helpers/score');
const landingServices = require('../data/landing-services');

const router = express.Router();

router.get('/', (req, res) => {
  const flash            = req.query.flash || null;
  const newsletterStatus = flash === 'ok' ? 'ok' : flash === 'error' ? 'error' : flash === 'captcha' ? 'captcha' : null;

  const featuredProducts = catalog.products
    .filter(p => p.stock > 0)
    .sort((a, b) => b.discount - a.discount)
    .slice(0, 3);

  // Niveles y puntos reales del club (app_settings 'puntos' o sus valores por
  // defecto): el tacómetro de la landing se dibuja con ellos.
  const club = loadPuntosConfig();

  res.render('home', {
    landingServices,
    club,
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

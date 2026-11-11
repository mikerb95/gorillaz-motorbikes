'use strict';
// Landing de estética: pintura, detailing y wrap. Contenido en data/estetica.js.
const express = require('express');
const estetica = require('../data/estetica');

const router = express.Router();
const PATH = '/pintura-detailing-wrap';

router.get(PATH, (req, res) => {
  const url = `${res.locals.siteUrl}${PATH}`;
  res.render('estetica', {
    ...estetica,
    title: 'Pintura, detailing y wrap de motos en Bogotá | Gorillaz Motorbikes',
    description: 'Pintura, corrección de barniz, sellado cerámico y wrap (forrado en vinilo) para motos en Bogotá. Mándanos fotos y te cotizamos sin compromiso.',
    canonicalPath: PATH,
    bodyClass: 'page-servicios page-estetica',
    waContext: `Hola, quiero cotizar pintura, detailing o wrap para mi moto. Les envío fotos. ${url}`,
    waWrap: `Hola, quiero cotizar un wrap (forrado) para mi moto. ${url}`,
  });
});

// Nombres con que la gente puede llegar o recordar la página.
router.get(['/pintura-y-detailing', '/estetica', '/wrap', '/forrado', '/forrado-motos', '/wrap-motos'],
  (req, res) => res.redirect(301, PATH));

module.exports = router;
module.exports.PATH = PATH;

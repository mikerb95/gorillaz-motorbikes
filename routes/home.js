'use strict';
const express = require('express');
const { RECAPTCHA_SITE_KEY } = require('../config');
const { refreshIfStale, publicProducts, findById, isPublic, categoryBySlug } = require('../helpers/catalog');
const { unitPrice } = require('../helpers/shop/pricing');
const { getShopConfig, activeBanner } = require('../helpers/shop/config');
const { isClubMember } = require('../helpers/cart');
const { localBusinessJsonLd } = require('../helpers/business');
const { SITE_URL } = require('../helpers/seo');
const { loadPuntosConfig } = require('../helpers/score');
const landingServices = require('../data/landing-services');
const bikeSystems     = require('../data/bike-systems.json');

const router = express.Router();

router.get('/', async (req, res) => {
  await refreshIfStale();
  const flash            = req.query.flash || null;
  const newsletterStatus = flash === 'ok' ? 'ok' : flash === 'error' ? 'error' : flash === 'captcha' ? 'captcha' : null;
  const member = isClubMember(res.locals.user);
  const priceOf = (p) => unitPrice(p, null, { member });

  // Destacados del home: solo publicados, con foto propia y disponibles.
  const cfg = getShopConfig();
  const offer = cfg.offerProductId ? findById(cfg.offerProductId) : null;
  const offerProduct = offer && isPublic(offer) && offer.stock !== 0 ? offer : null;
  const featuredProducts = publicProducts()
    .filter(p => p.image && p.stock !== 0 && (!offerProduct || p.id !== offerProduct.id))
    .sort((a, b) => (b.featured - a.featured) || (b.discount - a.discount))
    .slice(0, 3);

  // Niveles y puntos reales del club (app_settings 'puntos' o sus valores por
  // defecto): el tacómetro de la landing se dibuja con ellos.
  const club = loadPuntosConfig();

  res.render('home', {
    landingServices,
    bikeSystems,
    club,
    newsletterStatus,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    featuredProducts,
    offerProduct,
    offerPrice: offerProduct ? priceOf(offerProduct) : null,
    shopBanner: activeBanner(cfg),
    priceOf,
    categoryName: (slug) => (categoryBySlug(slug) || {}).name || '',
    title: 'Taller de motos en Bogotá | Gorillaz Motorbikes',
    description: 'Taller de motos en Bogotá: mecánica, electricidad, escaneo, pintura y alistamiento para la tecnomecánica. Tienda de accesorios con instalación. Agenda en línea.',
    canonicalPath: '/',
    bodyClass: 'page-home',
    structuredData: [
      localBusinessJsonLd(SITE_URL),
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#sitio`,
        name: 'Gorillaz Motorbikes',
        url: `${SITE_URL}/`,
        inLanguage: 'es-CO',
        publisher: { '@id': `${SITE_URL}/#negocio` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/tienda?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  });
});

module.exports = router;

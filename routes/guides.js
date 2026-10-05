'use strict';
// Guías del blog: /guias y /guias/:slug. Enlazan productos y servicios.

const express = require('express');
const { publishedGuides, findGuide, renderMarkdown } = require('../helpers/guides');
const { findById, isPublic } = require('../helpers/catalog');
const { unitPrice } = require('../helpers/shop/pricing');
const { isClubMember } = require('../helpers/cart');
const { abs, clip, breadcrumbLd } = require('../helpers/seo');
const landingServices = require('../data/landing-services');

const router = express.Router();

router.get('/guias', (req, res) => {
  const guides = publishedGuides();
  res.render('guides', {
    guides,
    title: 'Guías de mantenimiento y cuidado de motos | Gorillaz Motorbikes',
    description: 'Guías del taller para mantener tu moto, prepararla para la revisión técnico-mecánica y elegir accesorios según tu tipo de moto.',
    robots: guides.length ? '' : 'noindex, follow',
  });
});

router.get('/guias/:slug', (req, res, next) => {
  const g = findGuide(req.params.slug);
  const isAdmin = res.locals.user && res.locals.user.role === 'admin';
  if (!g || (g.status !== 'published' && !isAdmin)) return next();
  const member = isClubMember(res.locals.user);
  const products = (g.productIds || []).map(findById).filter((p) => p && isPublic(p));
  const services = landingServices.filter((s) => (g.serviceSlugs || []).includes(s.slug));
  const url = `/guias/${g.slug}`;
  const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Guías', path: '/guias' }, { name: g.title, path: url }];
  res.render('guide', {
    g, html: renderMarkdown(g.body), products, services, crumbs,
    priceOf: (p) => unitPrice(p, null, { member }),
    title: `${g.title} | Gorillaz Motorbikes`,
    description: clip(g.excerpt || g.body),
    canonicalPath: url,
    ogType: 'article',
    ogImage: g.image || undefined,
    robots: g.status === 'published' ? '' : 'noindex, nofollow',
    structuredData: [{
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: g.title,
      description: clip(g.excerpt || g.body),
      ...(g.image ? { image: [abs(g.image)] } : {}),
      datePublished: g.createdAt,
      dateModified: g.updatedAt,
      author: { '@type': 'Organization', name: 'Gorillaz Motorbikes', url: abs('/') },
      publisher: { '@type': 'Organization', name: 'Gorillaz Motorbikes', logo: { '@type': 'ImageObject', url: abs('/images/nobg_logo/logo_transp.png') } },
      mainEntityOfPage: abs(url),
    }, breadcrumbLd(crumbs)],
  });
});

module.exports = router;

'use strict';
// /sitemap.xml generado desde los mismos datos que pintan las páginas: si se
// agrega un servicio, curso o clasificado aprobado, entra solo al sitemap.
const express = require('express');
const { getActiveClassifieds } = require('../db');
const { courses } = require('../helpers/content');
const landingServices = require('../data/landing-services');
const servicesData = require('../data/services-detail');

const SITE = 'https://gorillazmotorbikes.com';

// Páginas fijas públicas. Las privadas (club, carrito, órdenes, facturas) no van.
const STATIC_PAGES = [
  { path: '/',             changefreq: 'weekly',  priority: '1.0' },
  { path: '/servicios',    changefreq: 'monthly', priority: '0.9' },
  { path: '/servicios/agendar', changefreq: 'monthly', priority: '0.8' },
  { path: '/tienda',       changefreq: 'weekly',  priority: '0.7' },
  { path: '/cursos',       changefreq: 'monthly', priority: '0.6' },
  { path: '/eventos',      changefreq: 'weekly',  priority: '0.6' },
  { path: '/club',         changefreq: 'monthly', priority: '0.6' },
  { path: '/clasificados', changefreq: 'daily',   priority: '0.6' },
  { path: '/duplicado-placas', changefreq: 'monthly', priority: '0.6' },
  { path: '/runt',         changefreq: 'monthly', priority: '0.5' },
  { path: '/faq',          changefreq: 'monthly', priority: '0.5' },
  { path: '/mision',       changefreq: 'yearly',  priority: '0.3' },
  { path: '/vision',       changefreq: 'yearly',  priority: '0.3' },
  { path: '/trabaja',      changefreq: 'monthly', priority: '0.3' },
];

const xmlEscape = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function urlEntry({ path, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(SITE + path)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod.slice(0, 10))}</lastmod>` : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority ? `    <priority>${priority}</priority>` : '',
    '  </url>',
  ].filter(Boolean).join('\n');
}

const router = express.Router();

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const entries = [...STATIC_PAGES];

    // Fichas de servicio: las mismas que enlaza el tablero de /servicios.
    const withDetail = new Set(servicesData.map(s => s.slug));
    for (const l of landingServices) {
      if (withDetail.has(l.slug)) entries.push({ path: `/servicios/${l.slug}`, changefreq: 'monthly', priority: '0.8' });
    }

    for (const c of courses) {
      if (c && c.slug) entries.push({ path: `/cursos/${encodeURIComponent(c.slug)}`, changefreq: 'monthly', priority: '0.5' });
    }

    // Solo anuncios aprobados (los únicos públicos).
    try {
      const listings = await getActiveClassifieds();
      for (const l of listings) {
        entries.push({ path: `/clasificados/${encodeURIComponent(l.id)}`, lastmod: l.updatedAt || l.createdAt, changefreq: 'weekly', priority: '0.4' });
      }
    } catch (e) {
      console.error('[sitemap] clasificados:', e.message);
    }

    // Las fichas de /tienda/:id no entran todavía: el catálogo actual es de
    // demostración. Agregarlas cuando se cargue el catálogo real.

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + entries.map(urlEntry).join('\n')
      + '\n</urlset>\n';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.send(xml);
  } catch (e) { next(e); }
});

module.exports = router;

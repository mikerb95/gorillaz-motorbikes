'use strict';
// Utilidades SEO compartidas: dominio canónico, recortes de texto y JSON-LD.

// Dominio canónico de producción (canonical, og:url, sitemap, feed, JSON-LD).
const SITE_URL = (process.env.SITE_URL || 'https://gorillazmotorbikes.com').replace(/\/+$/, '');

const abs = (path) => (/^https?:\/\//.test(path || '') ? path : `${SITE_URL}${path && path.startsWith('/') ? '' : '/'}${path || ''}`);

// Recorta a `max` caracteres sin partir palabras (para meta description).
function clip(text, max = 155) {
  const t = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

// JSON-LD seguro para incrustar en <script>: escapa "<" para que ningún texto
// del catálogo pueda cerrar la etiqueta.
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
  };
}

module.exports = { SITE_URL, abs, clip, jsonLd, breadcrumbLd };

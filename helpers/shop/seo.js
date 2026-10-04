'use strict';
// Metadatos SEO de las páginas de la tienda: title, description y JSON-LD de
// producto, categoría y landing por moto.

const { SITE_URL, abs, clip, breadcrumbLd } = require('../seo');
const { unitPrice, variantLabel } = require('./pricing');
const { bikeModelById, bikeLabel, categoryBySlug } = require('../catalog');
const { fmtCOP } = require('../money');

const BRAND = 'Gorillaz Motorbikes';

// Modelo de moto para el título: solo si el producto es específico de UN modelo
// y el nombre no lo trae ya.
function specificBike(p) {
  if (!p.compat || p.compat.length !== 1) return null;
  const m = bikeModelById(p.compat[0].bikeModelId);
  if (!m) return null;
  const label = bikeLabel(m);
  return { model: m, label, inName: p.name.toLowerCase().includes(m.model.toLowerCase()) };
}

function productTitle(p) {
  if (p.seoTitle) return p.seoTitle;
  const bike = specificBike(p);
  const name = bike && !bike.inName ? `${p.name} para ${bike.label}` : p.name;
  return `${name} | ${BRAND}`;
}

function productDescription(p) {
  if (p.seoDescription) return clip(p.seoDescription);
  const price = unitPrice(p).final;
  const parts = [`${p.name}${p.brand ? ` ${p.brand}` : ''} a ${fmtCOP(price)}.`];
  if (p.description) parts.push(p.description);
  if (p.installable) parts.push('Instalación en nuestro taller en Bogotá.');
  return clip(parts.join(' '));
}

function availability(p) {
  return p.stock === null || p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
}

// Product + Offer (o AggregateOffer si las variantes tienen precios distintos).
// La marca es la del fabricante: si no está cargada, se omite (nunca la tienda).
function productJsonLd(p, { reviews = null } = {}) {
  const url = abs(p.url);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#producto`,
    name: p.name,
    description: clip(p.description || p.name, 500),
    url,
  };
  if (p.gallery && p.gallery.length) ld.image = p.gallery.map(abs);
  if (p.sku) ld.sku = p.sku;
  if (p.brand) ld.brand = { '@type': 'Brand', name: p.brand };
  const cat = categoryBySlug(p.category);
  if (cat) ld.category = cat.name;

  const seller = { '@type': 'Organization', name: BRAND, url: SITE_URL };
  const variants = (p.variants || []);
  const prices = variants.length ? variants.map((v) => unitPrice(p, v).final) : [unitPrice(p).final];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (variants.length && low !== high) {
    ld.offers = {
      '@type': 'AggregateOffer', priceCurrency: 'COP', lowPrice: low, highPrice: high,
      offerCount: variants.length, availability: availability(p), url, seller,
    };
  } else {
    ld.offers = {
      '@type': 'Offer', price: low, priceCurrency: 'COP', availability: availability(p),
      itemCondition: 'https://schema.org/NewCondition', url, seller,
    };
  }
  if (variants.length) {
    ld.hasVariant = variants.map((v) => ({
      '@type': 'Product',
      name: `${p.name} ${variantLabel(v)}`.trim(),
      ...(v.sku ? { sku: v.sku } : {}),
      ...(v.color ? { color: v.color } : {}),
      ...(v.size ? { size: v.size } : {}),
      offers: {
        '@type': 'Offer', price: unitPrice(p, v).final, priceCurrency: 'COP',
        availability: v.stock === null || v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url,
      },
    }));
  }
  // Solo con reseñas reales aprobadas.
  if (reviews && reviews.count > 0) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: reviews.average, reviewCount: reviews.count, bestRating: 5, worstRating: 1 };
    ld.review = (reviews.items || []).slice(0, 5).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.authorName },
      datePublished: String(r.createdAt).slice(0, 10),
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      reviewBody: r.body,
    }));
  }
  return ld;
}

function productBreadcrumb(p) {
  const items = [{ name: 'Inicio', path: '/' }, { name: 'Tienda', path: '/tienda' }];
  const cat = categoryBySlug(p.category);
  if (cat) items.push({ name: cat.name, path: `/tienda/c/${cat.slug}` });
  items.push({ name: p.name, path: p.url });
  return { items, ld: breadcrumbLd(items) };
}

// Lista de productos de una página (ItemList) para categoría y moto.
function itemListLd(products, name) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(p.url), name: p.name })),
  };
}

function categoryMeta(cat, count) {
  return {
    title: cat.seoTitle || `${cat.name} para moto en Bogotá | ${BRAND}`,
    description: clip(cat.seoDescription || cat.intro ||
      `${cat.name} para tu moto: ${count} producto${count === 1 ? '' : 's'} con precio publicado, recogida en el taller y opción de instalación en Bogotá.`),
  };
}

function bikeMeta(m, count) {
  const label = bikeLabel(m);
  return {
    h1: `Accesorios y repuestos para ${label}`,
    title: m.seoTitle || `Accesorios y repuestos para ${label} en Bogotá | ${BRAND}`,
    description: clip(m.seoDescription || m.intro ||
      `Accesorios y repuestos compatibles con ${label}${m.cc ? ` ${m.cc} cc` : ''}: ${count} producto${count === 1 ? '' : 's'} con instalación en nuestro taller en Bogotá.`),
  };
}

module.exports = { BRAND, productTitle, productDescription, productJsonLd, productBreadcrumb, itemListLd, categoryMeta, bikeMeta, specificBike };

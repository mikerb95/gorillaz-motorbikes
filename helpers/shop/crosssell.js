'use strict';
// Venta cruzada: relacionados por compatibilidad, "comprados juntos" (desde
// pedidos pagados reales) y el puente servicio ↔ productos.

const repo = require('./repo');
const { publicProducts, findById } = require('../catalog');
const landingServices = require('../../data/landing-services');

const inStock = (p) => p.stock === null || p.stock > 0;

function relatedProducts(p, limit = 4) {
  const models = new Set((p.compat || []).map((c) => c.bikeModelId));
  const types = new Set(p.bikeTypes || []);
  return publicProducts()
    .filter((x) => x.id !== p.id && inStock(x))
    .map((x) => {
      let score = 0;
      if ((x.compat || []).some((c) => models.has(c.bikeModelId))) score += 3;
      if (x.category === p.category) score += 2;
      if ((x.bikeTypes || []).some((t) => types.has(t))) score += 1;
      return { x, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.x.featured - a.x.featured))
    .slice(0, limit)
    .map((s) => s.x);
}

// Caché de pares comprados juntos (se recalcula cada 10 minutos).
let pairs = null;
let pairsAt = 0;
async function boughtTogether(p, limit = 3) {
  try {
    if (!pairs || Date.now() - pairsAt > 600_000) {
      pairs = await repo.boughtTogetherCounts();
      pairsAt = Date.now();
    }
  } catch { return []; }
  const m = pairs.get(p.id);
  if (!m) return [];
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => findById(id))
    .filter((x) => x && x.status === 'active' && publicProducts().includes(x) && inStock(x))
    .slice(0, limit);
}

function servicesForProduct(p) {
  const slugs = new Set(p.relatedServices || []);
  return landingServices.filter((s) => slugs.has(s.slug)).map((s) => ({ slug: s.slug, name: s.name, href: `/servicios/${s.slug}` }));
}

function productsForService(slug, limit = 4) {
  return publicProducts().filter((p) => (p.relatedServices || []).includes(slug) && inStock(p)).slice(0, limit);
}

module.exports = { relatedProducts, boughtTogether, servicesForProduct, productsForService };

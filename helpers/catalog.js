'use strict';
// Catálogo de la tienda en memoria.
//
// El valor canónico vive en las tablas de la tienda (v17: products,
// product_variants, product_images, shop_categories, bike_models,
// product_compat, combos). Aquí se mantiene una copia en memoria para que las
// lecturas sean síncronas: la tienda, el KDS, el liquidador y el asesor leen
//   const { catalog } = require('../helpers/catalog')
// sobre esta misma referencia estable.
//
// Ciclo de vida en serverless: loadCatalog() corre en cada cold start (app.js)
// y tras cada escritura del admin. Para que otras instancias vean los cambios,
// las rutas de la tienda llaman refreshIfStale(), que recarga si la copia tiene
// más de un minuto. El stock que se cobra NO sale de aquí: la reserva se hace
// en la BD con una actualización condicional (helpers/shop/repo.js).

const repo = require('./shop/repo');

const PLACEHOLDER = null; // sin foto propia no se muestra ninguna imagen genérica

const catalog = {
  categories: [],
  products: [],
  bikeModels: [],
  combos: [],
  loadedAt: 0,
};

// Los productos demo (seed de desarrollo) nunca se publican en producción.
const SHOW_DEMO = process.env.SHOW_DEMO_PRODUCTS === '1' || process.env.NODE_ENV !== 'production';

function totalStock(p) {
  if (p.variants && p.variants.length) {
    if (p.variants.some((v) => v.stock === null)) return null;
    return p.variants.reduce((s, v) => s + (v.stock || 0), 0);
  }
  return p.ownStock;
}

// Campos derivados que leen las vistas y los consumidores antiguos
// (image/gallery/stock tenían esa forma cuando el catálogo era un blob).
function enrich(p) {
  p.stock = totalStock(p);
  p.gallery = (p.images || []).map((i) => i.url);
  p.image = p.gallery[0] || PLACEHOLDER;
  p.url = `/tienda/${p.slug}`;
  return p;
}

async function loadCatalog() {
  const data = await repo.loadAll();
  catalog.categories = data.categories;
  catalog.products = data.products.map(enrich);
  catalog.bikeModels = data.bikeModels;
  catalog.combos = data.combos;
  catalog.loadedAt = Date.now();
}

let inflight = null;
async function refreshIfStale(maxAgeMs = 60_000) {
  if (Date.now() - catalog.loadedAt < maxAgeMs) return;
  if (!inflight) inflight = loadCatalog().finally(() => { inflight = null; });
  try { await inflight; } catch (err) { console.error('[catalog] recarga fallida:', err.message); }
}

// ── Consultas ────────────────────────────────────────────────────────────

const isPublic = (p) => !!p && p.status === 'active' && (!p.isDemo || SHOW_DEMO);
const publicProducts = () => catalog.products.filter(isPublic);
const findById = (id) => catalog.products.find((p) => p.id === id) || null;
const findBySlug = (slug) => catalog.products.find((p) => p.slug === slug) || null;
const findByLegacyId = (id) => catalog.products.find((p) => p.legacyId === id || p.id === id) || null;
const categoryBySlug = (slug) => catalog.categories.find((c) => c.slug === slug) || null;
const bikeModelBySlug = (slug) => catalog.bikeModels.find((m) => m.slug === slug) || null;
const bikeModelById = (id) => catalog.bikeModels.find((m) => m.id === id) || null;

// Categorías con al menos un producto publicado. Nunca se muestran vacías.
function visibleCategories(products = publicProducts()) {
  const counts = new Map();
  for (const p of products) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  return catalog.categories
    .filter((c) => counts.get(c.slug) > 0)
    .map((c) => ({ ...c, count: counts.get(c.slug) }));
}

// ¿El producto sirve para ese modelo (y año, si se indica)?
function fitsBike(p, modelId, year) {
  const c = (p.compat || []).find((x) => x.bikeModelId === modelId);
  if (!c) return false;
  if (!year) return true;
  const m = bikeModelById(modelId) || {};
  const from = c.yearFrom ?? m.yearFrom;
  const to = c.yearTo ?? m.yearTo;
  return (from == null || year >= from) && (to == null || year <= to);
}

// Modelos con productos publicados compatibles (los que tienen landing).
function bikeModelsWithProducts() {
  const pub = publicProducts();
  return catalog.bikeModels
    .map((m) => ({ ...m, count: pub.filter((p) => fitsBike(p, m.id)).length }))
    .filter((m) => m.count > 0);
}

const bikeLabel = (m) => (m ? `${m.brand} ${m.model}`.trim() : '');

module.exports = {
  catalog, loadCatalog, refreshIfStale, enrich, totalStock,
  isPublic, publicProducts, findById, findBySlug, findByLegacyId,
  categoryBySlug, bikeModelBySlug, bikeModelById, visibleCategories, fitsBike, bikeModelsWithProducts, bikeLabel,
};

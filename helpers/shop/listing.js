'use strict';
// Filtros, orden y paginación de los listados de la tienda (categoría, moto,
// búsqueda). Las URLs limpias (/tienda/c/x, /tienda/moto/y) son las indexables;
// cualquier filtro por query (?q, ?sort, ?min, ?max, ?marca, ?tipo, ?page) se
// marca noindex con canonical a la URL limpia.

const { unitPrice } = require('./pricing');
const { fitsBike, bikeModelBySlug } = require('../catalog');
const { BIKE_TYPES } = require('./taxonomy');

const PER_PAGE = 24;
const SORTS = {
  '': 'Destacados',
  'precio-asc': 'Precio: menor a mayor',
  'precio-desc': 'Precio: mayor a menor',
  nuevos: 'Más nuevos',
  descuento: 'Mayor descuento',
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };

function parseQuery(query = {}) {
  return {
    q: String(query.q || '').trim().slice(0, 80),
    sort: Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? String(query.sort || '') : '',
    min: toInt(query.min),
    max: toInt(query.max),
    brand: String(query.marca || '').slice(0, 60),
    type: String(query.tipo || '').slice(0, 30),
    bike: String(query.moto || '').slice(0, 90),
    page: Math.max(1, toInt(query.page) || 1),
  };
}

const hasFilters = (f) => !!(f.q || f.sort || f.min !== null || f.max !== null || f.brand || f.type || f.bike || f.page > 1);

function matchesQuery(p, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = norm([p.name, p.brand, p.sku, p.description, ...(p.tags || [])].join(' '));
  return words.every((w) => hay.includes(w));
}

/**
 * @param {Array} base productos públicos del contexto (categoría, moto, todo)
 * @param {object} f filtros de parseQuery
 * @param {object} [opts] { member }
 */
function applyListing(base, f, { member = false } = {}) {
  const price = (p) => unitPrice(p, null, { member }).final;
  const bikeModel = f.bike ? bikeModelBySlug(f.bike) : null;

  const filtered = base.filter((p) => {
    if (f.q && !matchesQuery(p, f.q)) return false;
    if (f.brand && p.brand !== f.brand) return false;
    if (f.type && !(p.bikeTypes || []).includes(f.type)) return false;
    if (bikeModel && !fitsBike(p, bikeModel.id)) return false;
    const pr = price(p);
    if (f.min !== null && pr < f.min) return false;
    if (f.max !== null && pr > f.max) return false;
    return true;
  });

  const inStock = (p) => (p.stock === null || p.stock > 0 ? 1 : 0);
  const sorted = filtered.slice().sort((a, b) => {
    // Lo agotado siempre al final.
    const s = inStock(b) - inStock(a);
    if (s) return s;
    switch (f.sort) {
      case 'precio-asc': return price(a) - price(b);
      case 'precio-desc': return price(b) - price(a);
      case 'nuevos': return String(b.createdAt).localeCompare(String(a.createdAt));
      case 'descuento': return (b.discount || 0) - (a.discount || 0);
      default: return (b.featured - a.featured) || String(b.createdAt).localeCompare(String(a.createdAt));
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const page = Math.min(f.page, totalPages);
  const prices = base.map(price);

  // Facetas sobre el contexto completo (sin filtros), solo con valores reales.
  const brands = [...new Set(base.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const typeCounts = new Map();
  for (const p of base) for (const t of p.bikeTypes || []) typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  const bikeTypes = BIKE_TYPES.filter((t) => typeCounts.get(t.slug)).map((t) => ({ ...t, count: typeCounts.get(t.slug) }));

  return {
    products: sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    total: sorted.length,
    page,
    totalPages,
    priceRange: { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 },
    facets: { brands, bikeTypes },
    bikeModel,
  };
}

// Construye la query string conservando filtros y cambiando algunos.
function queryString(f, changes = {}) {
  const m = { ...f, ...changes };
  const qp = new URLSearchParams();
  if (m.q) qp.set('q', m.q);
  if (m.sort) qp.set('sort', m.sort);
  if (m.min !== null && m.min !== undefined) qp.set('min', String(m.min));
  if (m.max !== null && m.max !== undefined) qp.set('max', String(m.max));
  if (m.brand) qp.set('marca', m.brand);
  if (m.type) qp.set('tipo', m.type);
  if (m.bike) qp.set('moto', m.bike);
  if (m.page && m.page > 1) qp.set('page', String(m.page));
  const s = qp.toString();
  return s ? `?${s}` : '';
}

module.exports = { PER_PAGE, SORTS, parseQuery, hasFilters, applyListing, queryString, matchesQuery };

'use strict';
// Admin de la tienda y de la configuración comercial (montado en /admin):
//   /admin/tienda                productos (listado, crear, editar, estado)
//   /admin/tienda/categorias     categorías
//   /admin/tienda/motos          modelos de moto (compatibilidad y landings)
//   /admin/tienda/combos         combos armables y kits
//   /admin/tienda/entregas       recogida, domicilio por localidad, envío nacional
//   /admin/tienda/ajustes        puntos, banner, oferta del mes, cupón, carrito
//   /admin/tienda/cupones        cupones
//   /admin/tienda/importar       importación CSV (con vista previa)
//   /admin/tienda/exportar.csv   exportación CSV
//   /admin/negocio               dirección, horarios, WhatsApp, redes
//   /admin/resenas-tienda        moderación de reseñas
//   /admin/pqrs                  PQRS radicadas
//   /admin/guias                 guías del blog

const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadProduct } = require('../helpers/files');
const { setFlash } = require('../helpers/flash');
const settings = require('../helpers/settings');
const { db, logAdminAction } = require('../db');
const { catalog, loadCatalog, findById, bikeModelById } = require('../helpers/catalog');
const repo = require('../helpers/shop/repo');
const { slugify, uniqueSlug } = require('../helpers/shop/slug');
const { BIKE_TYPES } = require('../helpers/shop/taxonomy');
const { getDeliveryConfig, normalize: normalizeDelivery } = require('../helpers/shop/delivery');
const { getShopConfig, saveShopConfig } = require('../helpers/shop/config');
const { listCoupons, saveCoupon, normCode } = require('../helpers/shop/coupons');
const { listReviews, moderateReview } = require('../helpers/shop/reviews');
const { parseCSVObjects, toCSV } = require('../helpers/csv');
const { rowsToProducts, productsToRows, EXPORT_HEADERS } = require('../helpers/shop/import');
const { getBusiness, WEEK, DAY_NAMES } = require('../helpers/business');
const { allGuides, saveGuides } = require('../helpers/guides');
const landingServices = require('../data/landing-services');

const router = express.Router();
const guard = [requireAuth, requireAdmin];
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }).single('csv');

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const intOrNull = (v) => {
  const s = String(v ?? '').replace(/[$\s.]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const pct = (v) => Math.min(100, Math.max(0, intOrNull(v) || 0));
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const rows = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const audit = (req, action, detail) => logAdminAction && logAdminAction(req.userId, action, detail).catch(() => {});

// ── Productos ───────────────────────────────────────────────────────────

router.get('/tienda', guard, (req, res) => {
  const q = str(req.query.q, 80).toLowerCase();
  const cat = str(req.query.cat, 60);
  const status = str(req.query.estado, 20);
  let products = catalog.products;
  if (q) products = products.filter((p) => `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q));
  if (cat) products = products.filter((p) => p.category === cat);
  if (status) products = products.filter((p) => (status === 'demo' ? p.isDemo : p.status === status && !p.isDemo));
  res.render('admin/shop', {
    title: 'Tienda', products, categories: catalog.categories, q, cat, status,
    counts: {
      active: catalog.products.filter((p) => p.status === 'active' && !p.isDemo).length,
      draft: catalog.products.filter((p) => p.status === 'draft').length,
      demo: catalog.products.filter((p) => p.isDemo).length,
    },
  });
});

function formLocals(product) {
  return {
    title: product.id ? `Editar: ${product.name}` : 'Nuevo producto',
    product,
    categories: catalog.categories,
    bikeTypes: BIKE_TYPES,
    bikeModels: catalog.bikeModels,
    services: landingServices,
  };
}

router.get('/tienda/nuevo', guard, (req, res) => {
  res.render('admin/shop-edit', formLocals({
    name: '', slug: '', status: 'draft', category: '', price: 0, discount: 0, clubDiscount: 0, ownStock: null,
    images: [], variants: [], compat: [], bikeTypes: [], tags: [], specs: [], relatedServices: [],
  }));
});

router.get('/tienda/:id/editar', guard, (req, res) => {
  const product = findById(req.params.id);
  if (!product) return res.redirect('/admin/tienda');
  res.render('admin/shop-edit', formLocals(product));
});

// Arma el producto desde el formulario. Devuelve { product, errors }.
async function productFromForm(body) {
  const errors = [];
  const prev = body.id ? findById(body.id) : null;
  const name = str(body.name, 160);
  if (!name) errors.push('El nombre es obligatorio.');
  const price = intOrNull(body.price);
  if (price === null) errors.push('El precio es obligatorio.');
  const category = str(body.category, 60);
  if (!catalog.categories.some((c) => c.slug === category)) errors.push('Elige una categoría.');

  let slug = slugify(body.slug || name);
  if (await repo.slugTaken('products', slug, prev && prev.id)) {
    slug = uniqueSlug(slug, new Set(catalog.products.filter((p) => !prev || p.id !== prev.id).map((p) => p.slug)));
  }

  const specs = str(body.specs, 4000).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: l, value: '' };
  });
  const images = rows(body.images).map((i) => ({ url: str(i.url, 600), alt: str(i.alt, 160) }))
    .filter((i) => /^(https:\/\/|\/images\/)/.test(i.url));
  const variants = rows(body.variants).map((v) => ({
    id: str(v.id, 60) || undefined, color: str(v.color, 40), size: str(v.size, 20), sku: str(v.sku, 60),
    price: intOrNull(v.price), stock: intOrNull(v.stock),
  })).filter((v) => v.color || v.size);
  const compat = rows(body.compat).map((c) => ({
    bikeModelId: str(c.model, 60), yearFrom: intOrNull(c.from), yearTo: intOrNull(c.to),
  })).filter((c) => bikeModelById(c.bikeModelId));

  const status = ['active', 'draft', 'archived'].includes(body.status) ? body.status : 'draft';
  return {
    errors,
    product: {
      id: prev ? prev.id : undefined,
      legacyId: prev ? prev.legacyId : null,
      slug, name, category, price: price || 0,
      brand: str(body.brand, 80), sku: str(body.sku, 60),
      discount: pct(body.discount), clubDiscount: pct(body.clubDiscount),
      ownStock: variants.length ? null : intOrNull(body.stock),
      status,
      // Un producto demo que el admin publica a mano deja de ser demo.
      isDemo: prev ? (prev.isDemo && body.keepDemo === '1') : false,
      featured: body.featured === '1',
      description: str(body.description, 6000),
      includes: str(body.includes, 2000),
      warranty: str(body.warranty, 300),
      deliveryTime: str(body.deliveryTime, 200),
      tags: str(body.tags, 400).split(',').map((t) => t.trim()).filter(Boolean),
      bikeTypes: arr(body.bikeTypes).filter((t) => BIKE_TYPES.some((b) => b.slug === t)),
      relatedServices: arr(body.relatedServices).filter((s) => landingServices.some((l) => l.slug === s)),
      installable: body.installable === '1',
      installPrice: intOrNull(body.installPrice),
      installMinutes: intOrNull(body.installMinutes),
      seoTitle: str(body.seoTitle, 70),
      seoDescription: str(body.seoDescription, 170),
      specs, images, variants, compat,
    },
  };
}

router.post('/tienda/guardar', guard, async (req, res) => {
  const { product, errors } = await productFromForm(req.body);
  if (errors.length) {
    return res.status(400).render('admin/shop-edit', { ...formLocals({ ...findById(req.body.id), ...product }), errors });
  }
  const id = await repo.saveProduct(product);
  await loadCatalog();
  audit(req, 'tienda.producto.guardar', `${product.name} (${id})`);
  setFlash(res, 'success', 'Producto guardado.');
  res.redirect(303, `/admin/tienda/${id}/editar`);
});

router.post('/tienda/:id/estado', guard, async (req, res) => {
  const status = ['active', 'draft', 'archived'].includes(req.body.status) ? req.body.status : 'draft';
  await repo.setProductStatus(req.params.id, status);
  await loadCatalog();
  audit(req, 'tienda.producto.estado', `${req.params.id} → ${status}`);
  res.redirect(303, req.get('referer') && req.get('referer').includes('/admin/tienda') ? req.get('referer') : '/admin/tienda');
});

router.post('/tienda/upload-image', guard, uploadProduct, (req, res) => {
  res.json({ ok: true, urls: req.blobUrls || [] });
});

// ── Categorías ──────────────────────────────────────────────────────────

router.get('/tienda/categorias', guard, (req, res) => {
  const counts = new Map();
  for (const p of catalog.products) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  res.render('admin/shop-categories', { title: 'Categorías de la tienda', categories: catalog.categories, counts });
});

router.post('/tienda/categorias', guard, async (req, res) => {
  const slug = slugify(req.body.slug || req.body.name);
  if (!slug || !str(req.body.name)) { setFlash(res, 'error', 'Nombre obligatorio.'); return res.redirect(303, '/admin/tienda/categorias'); }
  await repo.saveCategory({
    slug, name: str(req.body.name, 80), position: intOrNull(req.body.position) || 0,
    intro: str(req.body.intro, 1200), seoTitle: str(req.body.seoTitle, 70), seoDescription: str(req.body.seoDescription, 170),
  });
  await loadCatalog();
  setFlash(res, 'success', 'Categoría guardada.');
  res.redirect(303, '/admin/tienda/categorias');
});

router.post('/tienda/categorias/eliminar', guard, async (req, res) => {
  const ok = await repo.deleteCategory(str(req.body.slug, 60));
  await loadCatalog();
  setFlash(res, ok ? 'success' : 'error', ok ? 'Categoría eliminada.' : 'No se puede eliminar: tiene productos.');
  res.redirect(303, '/admin/tienda/categorias');
});

// ── Modelos de moto ─────────────────────────────────────────────────────

router.get('/tienda/motos', guard, (req, res) => {
  const counts = new Map();
  for (const p of catalog.products) for (const c of p.compat || []) counts.set(c.bikeModelId, (counts.get(c.bikeModelId) || 0) + 1);
  const edit = req.query.id ? bikeModelById(req.query.id) : null;
  res.render('admin/shop-bikes', { title: 'Modelos de moto', models: catalog.bikeModels, counts, bikeTypes: BIKE_TYPES, edit });
});

router.post('/tienda/motos', guard, async (req, res) => {
  const brand = str(req.body.brand, 60);
  const model = str(req.body.model, 80);
  if (!brand || !model) { setFlash(res, 'error', 'Marca y modelo son obligatorios.'); return res.redirect(303, '/admin/tienda/motos'); }
  const prev = req.body.id ? bikeModelById(req.body.id) : null;
  let slug = slugify(req.body.slug || `${brand} ${model}`);
  if (await repo.slugTaken('bike_models', slug, prev && prev.id)) slug = uniqueSlug(slug, new Set(catalog.bikeModels.map((m) => m.slug)));
  await repo.saveBikeModel({
    id: prev ? prev.id : undefined, slug, brand, model, cc: intOrNull(req.body.cc),
    bikeType: BIKE_TYPES.some((t) => t.slug === req.body.bikeType) ? req.body.bikeType : '',
    yearFrom: intOrNull(req.body.yearFrom), yearTo: intOrNull(req.body.yearTo),
    intro: str(req.body.intro, 3000), seoTitle: str(req.body.seoTitle, 70), seoDescription: str(req.body.seoDescription, 170),
  });
  await loadCatalog();
  setFlash(res, 'success', 'Modelo guardado.');
  res.redirect(303, '/admin/tienda/motos');
});

router.post('/tienda/motos/eliminar', guard, async (req, res) => {
  await repo.deleteBikeModel(str(req.body.id, 60));
  await loadCatalog();
  setFlash(res, 'success', 'Modelo eliminado (y sus compatibilidades).');
  res.redirect(303, '/admin/tienda/motos');
});

// ── Combos ──────────────────────────────────────────────────────────────

router.get('/tienda/combos', guard, (req, res) => {
  const edit = req.query.id ? catalog.combos.find((c) => c.id === req.query.id) : null;
  res.render('admin/shop-combos', { title: 'Combos y kits', combos: catalog.combos, products: catalog.products.filter((p) => p.status !== 'archived'), bikeModels: catalog.bikeModels, edit, findById });
});

router.post('/tienda/combos', guard, async (req, res) => {
  const name = str(req.body.name, 100);
  if (!name) { setFlash(res, 'error', 'El nombre es obligatorio.'); return res.redirect(303, '/admin/tienda/combos'); }
  const prev = req.body.id ? catalog.combos.find((c) => c.id === req.body.id) : null;
  let slug = slugify(req.body.slug || name);
  if (await repo.slugTaken('combos', slug, prev && prev.id)) slug = uniqueSlug(slug, new Set(catalog.combos.map((c) => c.slug)));
  const kind = req.body.kind === 'kit' ? 'kit' : 'armable';
  const tiers = rows(req.body.tiers).map((t) => ({ min: intOrNull(t.min), pct: pct(t.pct) }))
    .filter((t) => t.min >= 2 && t.pct > 0);
  const items = arr(req.body.products).filter((id) => findById(id)).map((id) => ({ productId: id, qty: Math.max(1, intOrNull((req.body.qty || {})[id]) || 1) }));
  await repo.saveCombo({
    id: prev ? prev.id : undefined, slug, name, kind, description: str(req.body.description, 600),
    tiers, kitDiscount: pct(req.body.kitDiscount), bikeModelId: bikeModelById(req.body.bikeModelId) ? req.body.bikeModelId : null,
    active: req.body.active === '1', items,
  });
  await loadCatalog();
  setFlash(res, 'success', 'Combo guardado.');
  res.redirect(303, '/admin/tienda/combos');
});

router.post('/tienda/combos/eliminar', guard, async (req, res) => {
  await repo.deleteCombo(str(req.body.id, 60));
  await loadCatalog();
  res.redirect(303, '/admin/tienda/combos');
});

// ── Entregas ────────────────────────────────────────────────────────────

router.get('/tienda/entregas', guard, (req, res) => {
  res.render('admin/shop-delivery', { title: 'Entregas de la tienda', cfg: getDeliveryConfig() });
});

router.post('/tienda/entregas', guard, async (req, res) => {
  const b = req.body;
  const zones = getDeliveryConfig().local.zones.map((z) => ({
    slug: z.slug, name: z.name,
    enabled: arr(b.zoneEnabled).includes(z.slug),
    fee: intOrNull((b.zoneFee || {})[z.slug]),
  }));
  const cfg = normalizeDelivery({
    pickup: { enabled: b.pickupEnabled === '1', note: str(b.pickupNote, 200) },
    local: { enabled: b.localEnabled === '1', zones, freeOver: intOrNull(b.localFreeOver), eta: str(b.localEta, 160) },
    national: { enabled: b.nationalEnabled === '1', fee: intOrNull(b.nationalFee), freeOver: intOrNull(b.nationalFreeOver), eta: str(b.nationalEta, 160), note: str(b.nationalNote, 200) },
  });
  await settings.set('shop_delivery', cfg);
  audit(req, 'tienda.entregas', 'Configuración de entregas actualizada');
  setFlash(res, 'success', 'Entregas guardadas.');
  res.redirect(303, '/admin/tienda/entregas');
});

// ── Ajustes comerciales ─────────────────────────────────────────────────

router.get('/tienda/ajustes', guard, (req, res) => {
  res.render('admin/shop-settings', { title: 'Ajustes de la tienda', cfg: getShopConfig(), products: catalog.products.filter((p) => p.status === 'active' && !p.isDemo) });
});

router.post('/tienda/ajustes', guard, async (req, res) => {
  const b = req.body;
  await saveShopConfig({
    pointsPerAmount: intOrNull(b.pointsPerAmount),
    banner: { enabled: b.bannerEnabled === '1', text: str(b.bannerText, 160), cta: str(b.bannerCta, 40), href: str(b.bannerHref, 300), until: /^\d{4}-\d{2}-\d{2}$/.test(b.bannerUntil || '') ? b.bannerUntil : '' },
    offerProductId: findById(b.offerProductId) ? b.offerProductId : '',
    firstPurchaseCoupon: { enabled: b.fpEnabled === '1', kind: b.fpKind === 'amount' ? 'amount' : 'pct', value: intOrNull(b.fpValue), minSubtotal: intOrNull(b.fpMin) || 0, days: intOrNull(b.fpDays) || 30 },
    install: { daysAhead: Math.min(90, intOrNull(b.installDaysAhead) || 30), minLeadDays: intOrNull(b.installLead) ?? 1, serviceName: str(b.installServiceName, 80) || 'Instalación de accesorios' },
    abandonedCart: { enabled: b.acEnabled === '1', afterHours: Math.max(1, intOrNull(b.acHours) || 6) },
  });
  audit(req, 'tienda.ajustes', 'Ajustes comerciales actualizados');
  setFlash(res, 'success', 'Ajustes guardados.');
  res.redirect(303, '/admin/tienda/ajustes');
});

// ── Cupones ─────────────────────────────────────────────────────────────

router.get('/tienda/cupones', guard, async (req, res) => {
  res.render('admin/shop-coupons', { title: 'Cupones', coupons: await listCoupons() });
});

router.post('/tienda/cupones', guard, async (req, res) => {
  const code = normCode(req.body.code);
  const value = intOrNull(req.body.value);
  if (!code || !value) { setFlash(res, 'error', 'Código y valor son obligatorios.'); return res.redirect(303, '/admin/tienda/cupones'); }
  await saveCoupon({
    code, kind: req.body.kind === 'amount' ? 'amount' : 'pct', value: req.body.kind === 'amount' ? value : Math.min(100, value),
    minSubtotal: intOrNull(req.body.minSubtotal) || 0, maxUses: intOrNull(req.body.maxUses) || 1,
    email: str(req.body.email, 160).toLowerCase() || null,
    expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(req.body.expires || '') ? `${req.body.expires}T23:59:59-05:00` : null,
    active: req.body.active === '1',
  });
  setFlash(res, 'success', 'Cupón guardado.');
  res.redirect(303, '/admin/tienda/cupones');
});

// ── Importar / exportar ─────────────────────────────────────────────────

router.get('/tienda/importar', guard, (req, res) => {
  res.render('admin/shop-import', { title: 'Importar productos', preview: null, csvText: '', headers: EXPORT_HEADERS });
});

router.get('/tienda/plantilla.csv', guard, (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="plantilla-productos.csv"');
  res.send(toCSV([EXPORT_HEADERS]));
});

router.get('/tienda/exportar.csv', guard, (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="productos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCSV(productsToRows(catalog.products.filter((p) => !p.isDemo), catalog.bikeModels)));
});

router.post('/tienda/importar', guard, csvUpload, async (req, res) => {
  const csvText = req.file ? req.file.buffer.toString('utf8') : String(req.body.csvText || '');
  const parsed = rowsToProducts(parseCSVObjects(csvText), { categories: catalog.categories, bikeModels: catalog.bikeModels, existing: catalog.products });
  if (req.body.apply === '1' && !parsed.errors.length && parsed.items.length) {
    for (const it of parsed.items) await repo.saveProduct(it.product);
    await loadCatalog();
    audit(req, 'tienda.importar', `${parsed.items.length} productos`);
    setFlash(res, 'success', `Se importaron ${parsed.items.length} productos.`);
    return res.redirect(303, '/admin/tienda');
  }
  res.render('admin/shop-import', { title: 'Importar productos', preview: parsed, csvText, headers: EXPORT_HEADERS });
});

// ── Datos del negocio ───────────────────────────────────────────────────

router.get('/negocio', guard, (req, res) => {
  res.render('admin/business', { title: 'Datos del negocio', biz: getBusiness(), WEEK, DAY_NAMES });
});

router.post('/negocio', guard, async (req, res) => {
  const b = req.body;
  const hours = {};
  for (const d of WEEK) {
    const h = (b.hours || {})[d] || {};
    hours[d] = h.closed === '1' ? [] : [[h.open1, h.close1], [h.open2, h.close2]].filter(([a, c]) => a && c);
  }
  const num = (v) => { const n = Number(String(v || '').replace(',', '.')); return String(v || '').trim() && Number.isFinite(n) ? n : null; };
  await settings.set('business', {
    name: str(b.name, 80) || 'Gorillaz Motorbikes',
    address: { street: str(b.street, 120), locality: str(b.locality, 60) || 'Bogotá', region: str(b.region, 60) || 'Bogotá D.C.', postalCode: str(b.postalCode, 12), country: 'CO' },
    geo: { lat: num(b.lat), lng: num(b.lng) },
    phone: str(b.phone, 20),
    whatsapp: str(b.whatsapp, 20).replace(/\D/g, ''),
    email: str(b.email, 120),
    hours,
    hoursConfirmed: b.hoursConfirmed === '1',
    social: { facebook: str(b.facebook, 200), instagram: str(b.instagram, 200), tiktok: str(b.tiktok, 200) },
    mapsUrl: str(b.mapsUrl, 300),
  });
  audit(req, 'negocio.actualizar', 'Datos del negocio actualizados');
  setFlash(res, 'success', 'Datos del negocio guardados.');
  res.redirect(303, '/admin/negocio');
});

// ── Reseñas ─────────────────────────────────────────────────────────────

router.get('/resenas-tienda', guard, async (req, res) => {
  const status = ['pendiente', 'aprobada', 'rechazada'].includes(req.query.estado) ? req.query.estado : 'pendiente';
  const reviews = await listReviews(status);
  res.render('admin/reviews', { title: 'Reseñas', reviews, status, findById, services: landingServices });
});

router.post('/resenas-tienda/:id', guard, async (req, res) => {
  await moderateReview(req.params.id, req.body.status);
  audit(req, 'resena.moderar', `${req.params.id} → ${req.body.status}`);
  res.redirect(303, `/admin/resenas-tienda?estado=${encodeURIComponent(req.body.back || 'pendiente')}`);
});

// ── PQRS ────────────────────────────────────────────────────────────────

router.get('/pqrs', guard, async (req, res) => {
  const r = await db.execute('SELECT * FROM pqrs ORDER BY created_at DESC LIMIT 200');
  res.render('admin/pqrs', { title: 'PQRS', items: r.rows });
});

router.post('/pqrs/:id', guard, async (req, res) => {
  const status = ['recibida', 'en_tramite', 'respondida', 'cerrada'].includes(req.body.status) ? req.body.status : 'recibida';
  await db.execute({
    sql: "UPDATE pqrs SET status = ?, admin_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
    args: [status, str(req.body.notes, 2000), req.params.id],
  });
  res.redirect(303, '/admin/pqrs');
});

// ── Guías ───────────────────────────────────────────────────────────────

router.get('/guias', guard, (req, res) => {
  const edit = req.query.slug ? allGuides().find((g) => g.slug === req.query.slug) : null;
  res.render('admin/guides', { title: 'Guías', guides: allGuides(), edit, products: catalog.products.filter((p) => p.status === 'active'), services: landingServices });
});

router.post('/guias', guard, async (req, res) => {
  const title = str(req.body.title, 120);
  if (!title) { setFlash(res, 'error', 'El título es obligatorio.'); return res.redirect(303, '/admin/guias'); }
  const list = allGuides();
  const prevSlug = str(req.body.prevSlug, 120);
  const slug = slugify(req.body.slug || title);
  if (list.some((g) => g.slug === slug && g.slug !== prevSlug)) { setFlash(res, 'error', 'Ya existe una guía con esa URL.'); return res.redirect(303, '/admin/guias'); }
  const guide = {
    slug, title,
    excerpt: str(req.body.excerpt, 200),
    body: str(req.body.body, 20000),
    image: /^(https:\/\/|\/images\/)/.test(req.body.image || '') ? str(req.body.image, 600) : '',
    productIds: arr(req.body.productIds).filter((id) => findById(id)),
    serviceSlugs: arr(req.body.serviceSlugs).filter((s) => landingServices.some((l) => l.slug === s)),
    status: req.body.status === 'published' ? 'published' : 'draft',
    createdAt: (list.find((g) => g.slug === prevSlug) || {}).createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = list.filter((g) => g.slug !== prevSlug);
  next.push(guide);
  await saveGuides(next);
  setFlash(res, 'success', 'Guía guardada.');
  res.redirect(303, `/admin/guias?slug=${encodeURIComponent(slug)}`);
});

router.post('/guias/eliminar', guard, async (req, res) => {
  await saveGuides(allGuides().filter((g) => g.slug !== req.body.slug));
  res.redirect(303, '/admin/guias');
});

module.exports = router;
module.exports.productFromForm = productFromForm;

'use strict';
// Páginas públicas de la tienda:
//   /tienda                    listado general (búsqueda y filtros por query)
//   /tienda/c/:categoria       categoría indexable
//   /tienda/moto/:modelo       landing por modelo de moto (long-tail)
//   /tienda/combos             combos armables y kits
//   /tienda/:slug              ficha de producto
// Más las redirecciones 301 desde las URLs antiguas (/tienda?cat=, /tienda/:id).
// El carrito, el checkout y el pago viven en routes/cart.js.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  catalog, refreshIfStale, publicProducts, isPublic, findBySlug, findByLegacyId, categoryBySlug,
  bikeModelBySlug, bikeModelById, visibleCategories, fitsBike, bikeModelsWithProducts, bikeLabel,
} = require('../helpers/catalog');
const repo = require('../helpers/shop/repo');
const { unitPrice, variantLabel } = require('../helpers/shop/pricing');
const { parseQuery, hasFilters, applyListing, queryString, SORTS } = require('../helpers/shop/listing');
const shopSeo = require('../helpers/shop/seo');
const { relatedProducts, boughtTogether, servicesForProduct } = require('../helpers/shop/crosssell');
const { approvedSummary, verifyProductPurchase, alreadyReviewed, createReview } = require('../helpers/shop/reviews');
const { getDeliveryConfig, availableMethods, METHOD_LABELS } = require('../helpers/shop/delivery');
const { activeBanner } = require('../helpers/shop/config');
const { isClubMember } = require('../helpers/cart');
const { BIKE_TYPES, BIKE_TYPE_SLUGS } = require('../helpers/shop/taxonomy');
const { abs, breadcrumbLd } = require('../helpers/seo');
const { updateUser } = require('../db');
const { setFlash } = require('../helpers/flash');

const router = express.Router();

const reviewLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// Catálogo fresco en todas las rutas de la tienda (otras instancias pueden
// haberlo cambiado) y la moto elegida por el cliente ("Mi moto").
router.use(['/tienda', '/carrito', '/checkout'], async (req, res, next) => {
  await refreshIfStale();
  const slug = (res.locals.user && res.locals.user.shopBike) || req.cookies.mimoto || '';
  res.locals.myBike = slug ? bikeModelBySlug(slug) : null;
  res.locals.bikeModelsList = catalog.bikeModels;
  res.locals.shopBanner = activeBanner();
  next();
});

// Datos comunes de los listados.
function listingLocals(req, res, { base, basePath, label }) {
  const f = parseQuery(req.query);
  // "Mi moto" filtra por defecto los listados si el cliente no pidió otra.
  if (!req.query.moto && res.locals.myBike && req.query.todas !== '1') f.bike = res.locals.myBike.slug;
  const member = isClubMember(res.locals.user);
  const result = applyListing(base, f, { member });
  const filtered = hasFilters(parseQuery(req.query));
  return {
    f,
    result,
    member,
    basePath,
    label,
    sorts: SORTS,
    qs: (changes) => basePath + queryString(f, changes),
    categories: visibleCategories(),
    priceOf: (p) => unitPrice(p, null, { member }),
    // Filtros, orden, búsqueda y paginación no se indexan: canonical a la URL limpia.
    robots: filtered ? 'noindex, follow' : '',
    canonicalPath: basePath,
  };
}

// ── Listado general ─────────────────────────────────────────────────────
router.get('/tienda', (req, res) => {
  // URLs antiguas: ?cat=<categoria> → /tienda/c/<categoria>; ?cat=<tipo de moto> → filtro.
  if (req.query.cat) {
    const cat = String(req.query.cat);
    if (categoryBySlug(cat)) return res.redirect(301, `/tienda/c/${cat}`);
    if (BIKE_TYPE_SLUGS.has(cat)) return res.redirect(301, `/tienda?tipo=${cat}`);
    return res.redirect(301, '/tienda');
  }
  const base = publicProducts();
  const L = listingLocals(req, res, { base, basePath: '/tienda', label: 'Tienda' });
  const featured = base.filter((p) => p.featured).slice(0, 4);
  res.render('shop', {
    ...L,
    view: 'all',
    h1: 'Tienda de accesorios y repuestos para moto',
    intro: 'Accesorios, repuestos, cascos e indumentaria con precio publicado. Recoge en el taller en Bogotá o pide la instalación con tu compra.',
    featured,
    bikeModels: bikeModelsWithProducts(),
    title: L.f.q ? `Resultados para "${L.f.q}" | Tienda Gorillaz Motorbikes` : 'Tienda de accesorios y repuestos para moto en Bogotá | Gorillaz Motorbikes',
    description: 'Accesorios, repuestos, cascos e indumentaria para moto con precio publicado, recogida en el taller e instalación en Bogotá.',
    structuredData: [breadcrumbLd([{ name: 'Inicio', path: '/' }, { name: 'Tienda', path: '/tienda' }])],
    bodyClass: 'page-shop',
  });
});

// ── Categoría ───────────────────────────────────────────────────────────
router.get('/tienda/c/:cat', (req, res, next) => {
  const cat = categoryBySlug(req.params.cat);
  if (!cat) return next();
  const base = publicProducts().filter((p) => p.category === cat.slug);
  // Nunca se muestra una categoría vacía.
  if (!base.length) return res.redirect(302, '/tienda');
  const L = listingLocals(req, res, { base, basePath: `/tienda/c/${cat.slug}`, label: cat.name });
  const meta = shopSeo.categoryMeta(cat, base.length);
  const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Tienda', path: '/tienda' }, { name: cat.name, path: `/tienda/c/${cat.slug}` }];
  res.render('shop', {
    ...L,
    view: 'category',
    category: cat,
    h1: cat.name,
    intro: cat.intro,
    featured: [],
    bikeModels: [],
    crumbs,
    title: meta.title,
    description: meta.description,
    structuredData: [breadcrumbLd(crumbs), shopSeo.itemListLd(L.result.products, cat.name)],
    bodyClass: 'page-shop',
  });
});

// ── Landing por modelo de moto ──────────────────────────────────────────
router.get('/tienda/moto/:slug', (req, res, next) => {
  const model = bikeModelBySlug(req.params.slug);
  if (!model) return next();
  const base = publicProducts().filter((p) => fitsBike(p, model.id));
  const L = listingLocals(req, res, { base, basePath: `/tienda/moto/${model.slug}`, label: bikeLabel(model) });
  L.f.bike = ''; // el contexto ya es la moto
  const meta = shopSeo.bikeMeta(model, base.length);
  const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Tienda', path: '/tienda' }, { name: bikeLabel(model), path: `/tienda/moto/${model.slug}` }];
  const landingServices = require('../data/landing-services');
  // Solo se indexa con productos compatibles y texto propio del modelo.
  const indexable = base.length > 0 && !!model.intro;
  res.render('shop', {
    ...L,
    view: 'bike',
    bikeModel: model,
    h1: meta.h1,
    intro: model.intro,
    featured: [],
    bikeModels: [],
    crumbs,
    bikeServices: landingServices.filter((s) => ['mecanica', 'mecanica-rapida', 'electricidad', 'escaneo-de-motos', 'alistamiento-tecnomecanica'].includes(s.slug)),
    robots: indexable ? L.robots : 'noindex, follow',
    title: meta.title,
    description: meta.description,
    structuredData: [breadcrumbLd(crumbs), ...(base.length ? [shopSeo.itemListLd(L.result.products, meta.h1)] : [])],
    waContext: res.locals.waMsg.bike({ model: bikeLabel(model), url: abs(`/tienda/moto/${model.slug}`) }),
    bodyClass: 'page-shop',
  });
});

// ── "Mi moto" ───────────────────────────────────────────────────────────
router.post('/tienda/mi-moto', async (req, res) => {
  const model = bikeModelBySlug(String(req.body.moto || ''));
  const back = String(req.body.back || '/tienda');
  const safeBack = back.startsWith('/') && !back.startsWith('//') ? back : '/tienda';
  if (model) res.cookie('mimoto', model.slug, { maxAge: 365 * 86400000, httpOnly: true, sameSite: 'lax' });
  else res.clearCookie('mimoto');
  if (res.locals.user) await updateUser(res.locals.user.id, { shopBike: model ? model.slug : null }).catch(() => {});
  res.redirect(303, safeBack);
});

// ── Combos y kits ───────────────────────────────────────────────────────
router.get('/tienda/combos', (req, res) => {
  const member = isClubMember(res.locals.user);
  const combos = catalog.combos
    .filter((c) => c.active)
    .map((c) => ({
      ...c,
      bike: c.bikeModelId ? bikeModelById(c.bikeModelId) : null,
      products: c.items.map((it) => ({ ...it, product: catalog.products.find((p) => p.id === it.productId) }))
        .filter((it) => it.product && isPublic(it.product)),
    }))
    .filter((c) => c.products.length >= (c.kind === 'kit' ? c.items.length : 2));
  res.render('shop-combos', {
    combos,
    priceOf: (p) => unitPrice(p, null, { member }),
    title: 'Combos y kits para moto | Gorillaz Motorbikes',
    description: 'Arma tu combo de accesorios y repuestos para moto y ahorra con descuento escalonado, o elige un kit armado para tu modelo.',
    robots: combos.length ? '' : 'noindex, follow',
    bodyClass: 'page-shop',
  });
});

// ── Reseña de producto (comprador verificado) ───────────────────────────
router.post('/tienda/:slug/resena', reviewLimiter, async (req, res) => {
  const product = findBySlug(req.params.slug);
  if (!product || !isPublic(product)) return res.status(404).render('404');
  const back = `${product.url}#resenas`;
  const { orderCode, email, name, rating, body } = req.body;
  const r = parseInt(rating, 10);
  if (!name || !(r >= 1 && r <= 5) || !String(body || '').trim()) {
    setFlash(res, 'error', 'Completa tu nombre, la calificación y tu comentario.');
    return res.redirect(303, back);
  }
  const order = await verifyProductPurchase({ productId: product.id, orderCode, email });
  if (!order) {
    setFlash(res, 'error', 'No encontramos una compra pagada de este producto con ese número de pedido y correo.');
    return res.redirect(303, back);
  }
  if (await alreadyReviewed({ kind: 'producto', target: product.id, orderId: order.id })) {
    setFlash(res, 'info', 'Ya recibimos tu reseña para este pedido.');
    return res.redirect(303, back);
  }
  await createReview({ kind: 'producto', target: product.id, orderId: order.id, userId: order.userId, authorName: String(name).trim(), rating: r, body });
  setFlash(res, 'success', 'Gracias. Tu reseña se publicará cuando la revisemos.');
  res.redirect(303, back);
});

// ── Ficha de producto ───────────────────────────────────────────────────
router.get('/tienda/:slug', async (req, res, next) => {
  const slug = req.params.slug;
  let product = findBySlug(slug);
  if (!product) {
    // URL antigua por id (/tienda/nk-helmet-pro) o slug renombrado: 301.
    const legacy = findByLegacyId(slug);
    if (legacy) return res.redirect(301, legacy.url);
    const to = await repo.getRedirect(`/tienda/${slug}`).catch(() => null);
    if (to) return res.redirect(301, to);
    return next();
  }
  const isAdmin = res.locals.user && res.locals.user.role === 'admin';
  if (!isPublic(product) && !isAdmin) return next();

  const member = isClubMember(res.locals.user);
  const price = unitPrice(product, null, { member });
  const variants = (product.variants || []).map((v) => ({
    ...v, label: variantLabel(v), price: unitPrice(product, v, { member }),
    available: v.stock === null || v.stock > 0,
  }));
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
  const compat = (product.compat || []).map((c) => {
    const m = bikeModelById(c.bikeModelId);
    if (!m) return null;
    const from = c.yearFrom ?? m.yearFrom;
    const to = c.yearTo ?? m.yearTo;
    return { model: m, label: bikeLabel(m), years: from || to ? `${from || '...'} - ${to || 'actual'}` : '', href: `/tienda/moto/${m.slug}` };
  }).filter(Boolean);

  const reviews = await approvedSummary('producto', product.id).catch(() => ({ count: 0, average: 0, items: [] }));
  const together = await boughtTogether(product);
  const crumbs = shopSeo.productBreadcrumb(product);
  const deliveryCfg = getDeliveryConfig();
  const url = abs(product.url);
  const combos = catalog.combos.filter((c) => c.active && c.items.some((i) => i.productId === product.id));
  const myBikeFits = res.locals.myBike ? fitsBike(product, res.locals.myBike.id) : null;

  res.render('shop-product', {
    product,
    category: categoryBySlug(product.category),
    price,
    member,
    variants,
    colors,
    sizes,
    compat,
    myBikeFits,
    bikeTypeNames: (product.bikeTypes || []).map((t) => (BIKE_TYPES.find((b) => b.slug === t) || {}).name).filter(Boolean),
    related: relatedProducts(product).filter((p) => !together.includes(p)),
    together,
    services: servicesForProduct(product),
    combos,
    reviews,
    crumbs: crumbs.items,
    deliveryMethods: availableMethods(deliveryCfg).map((m) => METHOD_LABELS[m]),
    priceOf: (p) => unitPrice(p, null, { member }),
    waProduct: res.locals.waLink(res.locals.waMsg.product({ name: product.name, price: price.final, url })),
    waShare: res.locals.waShareLink(res.locals.waMsg.productShare({ name: product.name, price: price.final, url })),
    waInstall: res.locals.waLink(res.locals.waMsg.install({ name: product.name, url })),
    waContext: res.locals.waMsg.product({ name: product.name, price: price.final, url }),
    title: shopSeo.productTitle(product),
    description: shopSeo.productDescription(product),
    canonicalPath: product.url,
    robots: isPublic(product) ? '' : 'noindex, nofollow',
    ogType: 'product',
    ogImage: product.image || undefined,
    ogExtra: [
      { property: 'product:price:amount', content: String(price.final) },
      { property: 'product:price:currency', content: 'COP' },
      { property: 'product:availability', content: product.stock === null || product.stock > 0 ? 'in stock' : 'out of stock' },
      ...(product.brand ? [{ property: 'product:brand', content: product.brand }] : []),
    ],
    preloadImage: product.image || null,
    structuredData: [shopSeo.productJsonLd(product, { reviews }), crumbs.ld],
    bodyClass: 'page-shop page-product',
  });
});

module.exports = router;

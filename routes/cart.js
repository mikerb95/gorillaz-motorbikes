'use strict';
// Carrito, checkout de invitado, pago y seguimiento del pedido.
//
//   POST /cart/add | /cart/update | /cart/install | /cart/clear
//   GET  /carrito
//   GET  /checkout              (invitado o con sesión)
//   POST /checkout/cotizar      recalcula totales (entrega, cupón) para la vista
//   POST /pagar                 valida, reserva stock, crea pedido y va a pagar
//   GET  /payment/return        retorno de la pasarela
//   POST /payment/webhook       confirmación server-to-server
//   GET|POST /tienda/pedido     seguimiento con código + últimos 4 del teléfono
//
// Todos los montos salen de helpers/shop/pricing.js: lo que se ve es lo que se cobra.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { rateLimit } = require('express-rate-limit');
const { BOLD_API_KEY, BOLD_SECRET_KEY, BOLD_REDIRECT_URL } = require('../config');
const { db, createOrder, getOrderById, getOrderByPublicCode } = require('../db');
const { findById, isPublic } = require('../helpers/catalog');
const {
  MAX_QTY, makeKey, parseKey, emptyCart, getCart, priceCart, normalizeCart, saveCart, availableStock,
} = require('../helpers/cart');
const repo = require('../helpers/shop/repo');
const { getDeliveryConfig, availableMethods, activeZones, METHOD_LABELS } = require('../helpers/shop/delivery');
const { findValidCoupon } = require('../helpers/shop/coupons');
const { getShopConfig } = require('../helpers/shop/config');
const { availableDates, isValidSlot } = require('../helpers/shop/install-slots');
const { makePublicCode, orderItemsFromCart, stockLines, confirmPaid, markFailed } = require('../helpers/shop/orders');
const { getBusiness } = require('../helpers/business');
const { abs } = require('../helpers/seo');

const router = express.Router();

const cartLimiter = rateLimit({
  windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Espera un momento.' },
});
const payLimiter = rateLimit({ windowMs: 10 * 60_000, max: 15, standardHeaders: true, legacyHeaders: false });
const trackLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
});

const wantsJSON = (req) => req.headers['x-requested-with'] === 'fetch' || (req.headers.accept || '').includes('application/json');
const NOINDEX = 'noindex, nofollow';

// Carrito guardado para usuarios con sesión (recordatorio de carrito abandonado).
async function persistCart(req, cart) {
  if (!req.userId) return;
  const items = JSON.stringify({ items: cart.items, install: cart.install });
  if (!Object.keys(cart.items).length) {
    await db.execute({ sql: 'DELETE FROM saved_carts WHERE user_id = ?', args: [req.userId] }).catch(() => {});
    return;
  }
  await db.execute({
    sql: `INSERT INTO saved_carts (user_id, items, updated_at, reminded_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL)
          ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at, reminded_at = NULL`,
    args: [req.userId, items],
  }).catch((e) => console.error('[cart] persist:', e.message));
}

async function commitCart(req, res, cart) {
  const clean = normalizeCart(cart);
  req.cart = clean;
  saveCart(res, clean);
  await persistCart(req, clean);
  return clean;
}

function cartJSON(req, res, cart, message) {
  const priced = priceCart(cart, { user: res.locals.user });
  return {
    ok: true,
    message,
    cartCount: priced.count,
    subtotal: priced.merchandise,
    cartItems: priced.lines.map((l) => ({ id: l.key, name: l.name, qty: l.qty, total: l.lineTotal })),
  };
}

// ── Carrito ─────────────────────────────────────────────────────────────

router.post('/cart/add', cartLimiter, async (req, res) => {
  const { id, variant } = req.body;
  const product = findById(String(id || ''));
  const fail = (status, message) => (wantsJSON(req) ? res.status(status).json({ ok: false, message }) : res.redirect(303, product ? product.url : '/tienda'));
  if (!product || !isPublic(product)) return fail(400, 'Producto no encontrado');

  let v = null;
  if (product.variants && product.variants.length) {
    v = product.variants.find((x) => x.id === String(variant || '')) || null;
    if (!v) return fail(400, 'Elige una opción (color o talla) antes de agregar.');
  }
  const stock = availableStock(product, v);
  if (stock === 0) return fail(400, 'Producto agotado');

  const cart = getCart(req);
  const key = makeKey(product.id, v && v.id);
  const add = Math.max(1, parseInt(req.body.qty || '1', 10) || 1);
  let qty = Math.min(MAX_QTY, (parseInt(cart.items[key], 10) || 0) + add);
  if (typeof stock === 'number') qty = Math.min(qty, stock);
  cart.items[key] = qty;
  const install = req.body.install === true || req.body.install === '1' || req.body.install === 'on';
  if (install && product.installable) cart.install[key] = true;
  const clean = await commitCart(req, res, cart);

  const buyNow = req.body.buyNow === true || req.body.buyNow === '1';
  if (wantsJSON(req)) {
    return res.json({ ...cartJSON(req, res, clean, `${product.name} quedó en tu carrito`), redirect: buyNow ? '/checkout' : null });
  }
  res.redirect(303, buyNow ? '/checkout' : '/carrito');
});

router.post('/cart/update', cartLimiter, async (req, res) => {
  const cart = getCart(req);
  const key = String(req.body.key || req.body.id || '');
  const { productId } = parseKey(key);
  const qty = Math.max(0, Math.min(MAX_QTY, parseInt(req.body.qty || '0', 10) || 0));
  if (qty === 0 || !findById(productId)) { delete cart.items[key]; delete cart.install[key]; } else cart.items[key] = qty;
  const clean = await commitCart(req, res, cart);
  if (wantsJSON(req)) return res.json(cartJSON(req, res, clean));
  res.redirect(303, '/carrito');
});

router.post('/cart/install', cartLimiter, async (req, res) => {
  const cart = getCart(req);
  const key = String(req.body.key || '');
  const product = findById(parseKey(key).productId);
  if (cart.items[key] && product && product.installable && (req.body.on === '1' || req.body.on === 'on' || req.body.on === true)) cart.install[key] = true;
  else delete cart.install[key];
  await commitCart(req, res, cart);
  if (wantsJSON(req)) return res.json({ ok: true });
  res.redirect(303, req.body.back === 'checkout' ? '/checkout' : '/carrito');
});

router.post('/cart/clear', async (req, res) => {
  await commitCart(req, res, emptyCart());
  res.redirect(303, '/carrito');
});

router.get('/carrito', async (req, res) => {
  const cart = getCart(req);
  const clean = normalizeCart(cart);
  if (JSON.stringify(clean) !== JSON.stringify({ items: cart.items, install: cart.install })) saveCart(res, clean);
  const priced = priceCart(clean, { user: res.locals.user });
  const deliveryCfg = getDeliveryConfig();
  // Sugerencias: compatibles con lo que hay en el carrito y aún no agregados.
  const { relatedProducts } = require('../helpers/shop/crosssell');
  const inCart = new Set(priced.lines.map((l) => l.productId));
  const suggestions = [];
  for (const l of priced.lines) {
    for (const p of relatedProducts(findById(l.productId), 3)) {
      if (!inCart.has(p.id) && !suggestions.includes(p)) suggestions.push(p);
    }
  }
  res.render('cart', {
    priced,
    deliveryMethods: availableMethods(deliveryCfg),
    deliveryCfg,
    METHOD_LABELS,
    suggestions: suggestions.slice(0, 4),
    title: 'Tu carrito | Gorillaz Motorbikes',
    robots: NOINDEX,
    bodyClass: 'page-shop',
  });
});

// ── Checkout ────────────────────────────────────────────────────────────

function checkoutLocals(req, res, priced, extra = {}) {
  const deliveryCfg = getDeliveryConfig();
  const shopCfg = getShopConfig();
  const biz = getBusiness();
  return {
    priced,
    deliveryCfg,
    methods: availableMethods(deliveryCfg),
    zones: activeZones(deliveryCfg),
    METHOD_LABELS,
    installDates: priced.hasInstallation ? availableDates(biz, shopCfg.install) : [],
    form: req.body && Object.keys(req.body).length ? req.body : {},
    title: 'Finalizar compra | Gorillaz Motorbikes',
    robots: NOINDEX,
    bodyClass: 'page-shop page-checkout',
    ...extra,
  };
}

router.get('/checkout', (req, res) => {
  const priced = priceCart(getCart(req), { user: res.locals.user });
  if (!priced.count) return res.redirect('/carrito');
  res.render('checkout', checkoutLocals(req, res, priced));
});

// Cotización en vivo para el resumen del checkout.
router.post('/checkout/cotizar', cartLimiter, async (req, res) => {
  const { delivery, coupon, couponError } = await readCheckoutOptions(req);
  const priced = priceCart(getCart(req), { user: res.locals.user, coupon, delivery });
  res.json({
    ok: true,
    couponError,
    coupon: coupon ? coupon.code : null,
    lines: priced.lines.map((l) => ({ key: l.key, total: l.lineTotal, install: l.install })),
    itemsSubtotal: priced.itemsSubtotal,
    discounts: priced.discounts,
    installationTotal: priced.installationTotal,
    installationPending: priced.installationPending,
    delivery: priced.delivery,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    savings: priced.savings,
  });
});

async function readCheckoutOptions(req) {
  const method = String(req.body.delivery_method || '');
  const zone = String(req.body.delivery_zone || '');
  const delivery = { config: getDeliveryConfig(), method, zone };
  let coupon = null;
  let couponError = null;
  const code = String(req.body.coupon || '').trim();
  if (code) {
    const r = await findValidCoupon(code, req.body.customer_email).catch(() => ({ ok: false, error: 'No pudimos validar el cupón.' }));
    if (r.ok) coupon = r.coupon; else couponError = r.error;
  }
  return { delivery, coupon, couponError };
}

const clean = (v, max = 200) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valida el formulario. Devuelve { errors, data }.
function validateCheckout(body, priced, { methods, installDates }) {
  const errors = [];
  const data = {
    name: clean(body.customer_name, 120),
    email: clean(body.customer_email, 160).toLowerCase(),
    phone: clean(body.customer_phone, 30),
    method: String(body.delivery_method || ''),
    zone: String(body.delivery_zone || ''),
    address: clean(body.customer_address, 200),
    dept: clean(body.customer_dept, 80),
    city: clean(body.customer_city, 80),
    notes: clean(body.notes, 500),
    installDate: String(body.install_date || ''),
    installTime: String(body.install_time || ''),
    plate: clean(body.install_plate, 10).toUpperCase().replace(/\s/g, ''),
    acceptTerms: body.accept_terms === 'on' || body.accept_terms === '1',
  };
  if (!data.name) errors.push('Escribe tu nombre completo.');
  if (!EMAIL_RE.test(data.email)) errors.push('Escribe un correo válido para enviarte la confirmación.');
  if (String(data.phone).replace(/\D/g, '').length < 7) errors.push('Escribe un teléfono de contacto (WhatsApp).');
  if (!methods.includes(data.method)) errors.push('Elige cómo quieres recibir tu pedido.');
  if (data.method === 'local' || data.method === 'national') {
    if (!data.address) errors.push('Escribe la dirección de entrega.');
    if (data.method === 'national' && (!data.dept || !data.city)) errors.push('Elige el departamento y la ciudad de entrega.');
  }
  if (data.method === 'local') { data.city = 'Bogotá'; data.dept = 'Bogotá D.C.'; }
  if (priced.hasInstallation) {
    if (!installDates.some((d) => d.date === data.installDate && (!data.installTime || d.slots.includes(data.installTime)))) {
      errors.push('Elige una fecha y hora disponibles para la instalación.');
    }
    if (data.plate.length < 5) errors.push('Escribe la placa de la moto para la instalación.');
  }
  if (!data.acceptTerms) errors.push('Debes aceptar los términos, la política de envíos y la de cambios y devoluciones.');
  return { errors, data };
}

async function createBoldPaymentLink({ orderId, totalCOP, description }) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const res = await fetch('https://integrations.api.bold.co/online-payment/v2/payment-vouchers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `x-api-key ${BOLD_API_KEY}` },
    body: JSON.stringify({
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: totalCOP },
      description,
      order_id: orderId,
      expiration_date: expiresAt,
      redirect_url: BOLD_REDIRECT_URL,
    }),
  });
  if (!res.ok) throw new Error(`Bold API error ${res.status}: ${await res.text()}`);
  return (await res.json()).payload; // { payment_link, payment_id }
}

router.post('/pagar', payLimiter, async (req, res) => {
  const cart = getCart(req);
  const { delivery, coupon, couponError } = await readCheckoutOptions(req);
  const priced = priceCart(cart, { user: res.locals.user, coupon, delivery });
  if (!priced.count) return res.redirect('/carrito');

  const locals = checkoutLocals(req, res, priced);
  const { errors, data } = validateCheckout(req.body, priced, locals);
  if (couponError) errors.push(couponError);
  if (priced.delivery && !priced.delivery.ok) errors.push(priced.delivery.error);
  if (errors.length) return res.status(400).render('checkout', { ...locals, errors });

  // Reserva de stock atómica: si alguien compró la última unidad, se avisa.
  const items = orderItemsFromCart(priced);
  const reserve = await repo.reserveStock(stockLines(items));
  if (!reserve.ok) {
    const p = findById(reserve.failed.productId);
    const { loadCatalog } = require('../helpers/catalog');
    await loadCatalog().catch(() => {});
    return res.status(409).render('checkout', {
      ...checkoutLocals(req, res, priceCart(cart, { user: res.locals.user, coupon, delivery })),
      errors: [`"${p ? p.name : 'Un producto'}" ya no tiene las unidades que pediste. Ajustamos tu carrito; revísalo antes de pagar.`],
    });
  }

  const orderId = uuidv4();
  let publicCode = makePublicCode();
  const order = {
    id: orderId,
    userId: req.userId || null,
    boldOrderId: orderId,
    status: 'pending',
    publicCode,
    total: priced.total,
    subtotal: priced.itemsSubtotal,
    discountTotal: priced.discountTotal,
    discounts: priced.discounts,
    items,
    customerName: data.name,
    customerEmail: data.email,
    customerPhone: data.phone,
    customerAddress: data.method === 'pickup' ? null : data.address,
    customerCity: data.method === 'pickup' ? null : data.city,
    customerDept: data.method === 'pickup' ? null : data.dept,
    deliveryMethod: data.method,
    deliveryZone: priced.delivery && priced.delivery.zone ? priced.delivery.zone : null,
    deliveryFee: priced.deliveryFee,
    installation: priced.hasInstallation ? { date: data.installDate, time: data.installTime || null, plate: data.plate, pendingPrice: priced.installationPending } : null,
    couponCode: coupon ? coupon.code : null,
    notes: data.notes || null,
  };

  try {
    try {
      await createOrder(order);
    } catch (e) {
      if (!/UNIQUE/i.test(e.message)) throw e;
      order.publicCode = publicCode = makePublicCode(); // colisión improbable: un reintento
      await createOrder(order);
    }
    await db.execute({ sql: 'UPDATE orders SET stock_decremented = 1 WHERE id = ?', args: [orderId] });

    const payload = await createBoldPaymentLink({
      orderId,
      totalCOP: priced.total,
      description: `Pedido ${publicCode} en Gorillaz Motorbikes`,
    });
    res.cookie('bold_pending', JSON.stringify({ orderId, total: priced.total }), { httpOnly: true, maxAge: 35 * 60 * 1000, sameSite: 'lax' });
    return res.redirect(303, payload.payment_link);
  } catch (err) {
    console.error('[Checkout] Error creando el pago:', err.message);
    const exists = await getOrderById(orderId).catch(() => null);
    if (exists) await markFailed(orderId, null).catch(() => {});
    else await repo.releaseStock(stockLines(items)).catch(() => {});
    return res.status(502).render('payment/failed', {
      reason: 'No fue posible conectar con la pasarela de pago. Tu carrito sigue guardado; intenta de nuevo en unos minutos.',
      robots: NOINDEX,
    });
  }
});

// ── Pago ────────────────────────────────────────────────────────────────

function verifyBoldSignature(orderId, status, amount, receivedHash) {
  if (!BOLD_SECRET_KEY) return true; // sin secreto configurado (pendiente de endurecer)
  try {
    const expected = crypto.createHmac('sha256', BOLD_SECRET_KEY).update(`${orderId}${amount}${status}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(receivedHash), 'hex'));
  } catch { return false; }
}

// La pasarela redirige aquí: /payment/return?bold-order-id=…&bold-tx-status=APPROVED
router.get('/payment/return', async (req, res) => {
  const status = String(req.query['bold-tx-status'] || '').toUpperCase();
  const boldId = String(req.query['bold-order-id'] || '');
  const sigHash = String(req.query['bold-signature'] || '');
  let pending = null;
  try { pending = JSON.parse(req.cookies.bold_pending || 'null'); } catch { /* cookie inválida */ }
  res.clearCookie('bold_pending');
  const orderId = pending && pending.orderId;

  if (status === 'APPROVED') {
    // El retorno es un redirect del navegador y se puede falsificar: solo se
    // confirma con firma válida. Sin ella, el webhook firmado confirma.
    const trusted = !BOLD_SECRET_KEY || (sigHash && pending && verifyBoldSignature(boldId, status, pending.total, sigHash));
    if (!trusted) {
      if (orderId) await markFailed(orderId, boldId, 'pending_confirmation').catch(() => {});
      return res.render('payment/failed', { reason: 'Estamos verificando tu pago. Te confirmaremos por correo en cuanto se procese.', robots: NOINDEX });
    }
    let order = null;
    if (orderId) order = await confirmPaid(orderId, boldId).catch((e) => { console.error('[Orders] confirmPaid:', e.message); return null; });
    req.cart = emptyCart();
    saveCart(res, req.cart);
    await persistCart(req, req.cart);
    return res.render('payment/success', { order, robots: NOINDEX, title: 'Pedido confirmado | Gorillaz Motorbikes' });
  }

  if (status === 'PENDING') {
    if (orderId) await markFailed(orderId, boldId, 'pending_confirmation').catch(() => {});
    return res.render('payment/failed', { reason: 'Tu pago está pendiente de confirmación. Te avisaremos por correo cuando se procese.', robots: NOINDEX });
  }

  if (orderId) await markFailed(orderId, boldId).catch(() => {});
  return res.render('payment/failed', { reason: 'El pago fue rechazado o cancelado. Tu carrito sigue guardado.', robots: NOINDEX });
});

// Webhook server-to-server: siempre exige firma válida.
router.post('/payment/webhook', async (req, res) => {
  const { order_id: orderId, status, amount, signature } = req.body || {};
  if (!orderId || !status) return res.status(400).json({ ok: false, message: 'Payload inválido' });
  const normalized = String(status).toUpperCase();
  const totalAmount = amount?.total_amount ?? amount ?? 0;
  if (!BOLD_SECRET_KEY || !signature || !verifyBoldSignature(orderId, normalized, totalAmount, signature)) {
    console.warn('[Bold Webhook] Firma inválida o ausente para orden', orderId);
    return res.status(401).json({ ok: false, message: 'Firma inválida' });
  }
  try {
    if (normalized === 'APPROVED') await confirmPaid(orderId, orderId);
    else if (normalized === 'PENDING') await markFailed(orderId, orderId, 'pending_confirmation');
    else await markFailed(orderId, orderId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Bold Webhook] Error:', err.message);
    return res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

// ── Seguimiento del pedido ──────────────────────────────────────────────

const FULFILLMENT_STEPS = [
  { key: 'confirmado', label: 'Pago confirmado' },
  { key: 'preparando', label: 'Preparando tu pedido' },
  { key: 'listo', label: 'Listo para recoger o en camino' },
  { key: 'entregado', label: 'Entregado' },
];

function trackView(order) {
  if (!order) return null;
  const paid = order.status === 'paid';
  const idx = FULFILLMENT_STEPS.findIndex((s) => s.key === order.fulfillmentStatus);
  return {
    code: order.publicCode,
    createdAt: order.createdAt,
    payment: paid ? 'Pagado' : order.status === 'pending_confirmation' ? 'Pago en verificación' : order.status === 'failed' ? 'Pago no completado' : 'Pendiente de pago',
    paid,
    steps: FULFILLMENT_STEPS.map((s, i) => ({ ...s, done: paid && idx >= i, current: paid && idx === i })),
    cancelled: order.fulfillmentStatus === 'cancelado',
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, install: i.install })),
    total: order.total,
    deliveryLabel: METHOD_LABELS[order.deliveryMethod] || 'Recoger en el taller',
    installation: order.installation,
  };
}

router.get('/tienda/pedido', (req, res) => {
  res.render('shop-track', {
    result: null, error: null, form: {},
    title: 'Seguimiento de pedido | Gorillaz Motorbikes',
    description: 'Consulta el estado de tu pedido de la tienda Gorillaz Motorbikes con el número de pedido y los últimos 4 dígitos de tu teléfono.',
    bodyClass: 'page-shop',
  });
});

router.post('/tienda/pedido', trackLimiter, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().replace(/\s/g, '');
  const tel4 = String(req.body.tel4 || '').trim();
  const render = (status, error, result = null) => res.status(status).render('shop-track', {
    result, error, form: { code }, title: 'Seguimiento de pedido | Gorillaz Motorbikes', robots: NOINDEX, bodyClass: 'page-shop',
  });
  if (!/^GZ-[A-Z0-9]{6}$/.test(code) || !/^\d{4}$/.test(tel4)) return render(400, 'Escribe el número de pedido (GZ-XXXXXX) y los últimos 4 dígitos de tu teléfono.');
  const order = await getOrderByPublicCode(code);
  // Mismo mensaje si no existe o no coincide el teléfono (sin enumeración).
  if (!order || String(order.customerPhone || '').replace(/\D/g, '').slice(-4) !== tel4) {
    return render(404, 'No encontramos un pedido con esos datos.');
  }
  render(200, null, trackView(order));
});

module.exports = router;
module.exports.validateCheckout = validateCheckout;
module.exports.trackView = trackView;
module.exports.abs = abs;

'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { catalog }  = require('../helpers/catalog');
const { getCart, recalc, saveCart } = require('../helpers/cart');
const { BOLD_API_KEY, BOLD_SECRET_KEY, BOLD_REDIRECT_URL, resendClient } = require('../config');
const { createOrder, updateOrderStatus, claimStockDecrement, getOrderById } = require('../db');
const { decrementStock } = require('../helpers/stock');

const cartLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Espera un momento.' },
});

const BOLD_API_BASE = 'https://integrations.api.bold.co';

async function createBoldPaymentLink({ orderId, totalCOP, description }) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
  const body = {
    amount_type: 'CLOSE',
    amount: { currency: 'COP', total_amount: totalCOP },
    description,
    order_id: orderId,
    expiration_date: expiresAt,
    redirect_url: BOLD_REDIRECT_URL,
  };
  const res = await fetch(`${BOLD_API_BASE}/online-payment/v2/payment-vouchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `x-api-key ${BOLD_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bold API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.payload; // { payment_link, payment_id }
}

function verifyBoldSignature(orderId, status, amount, receivedHash) {
  if (!BOLD_SECRET_KEY) return true; // skip if not configured
  const message = `${orderId}${amount}${status}`;
  const expected = crypto.createHmac('sha256', BOLD_SECRET_KEY).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receivedHash, 'hex'));
}

async function sendOrderConfirmationEmails(order) {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 're_dummy_key_to_prevent_crash_123') return;

  const itemRows = order.items.map(i =>
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${i.unitPrice.toLocaleString('es-CO')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${i.total.toLocaleString('es-CO')}</td>
    </tr>`
  ).join('');

  const clientHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#F25C05">¡Gracias por tu compra, ${order.customerName}!</h2>
      <p>Hemos recibido tu pedido y está siendo procesado. Aquí está el resumen:</p>
      <p><strong>N° de orden:</strong> ${order.id}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left">Producto</th>
            <th style="padding:8px;text-align:center">Cant.</th>
            <th style="padding:8px;text-align:right">Precio c/u</th>
            <th style="padding:8px;text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:8px;text-align:right"><strong>Total pagado</strong></td>
            <td style="padding:8px;text-align:right"><strong>$${order.total.toLocaleString('es-CO')} COP</strong></td>
          </tr>
        </tfoot>
      </table>
      <h3 style="margin-top:24px">Datos de envío</h3>
      <p>
        ${order.customerAddress}<br/>
        ${order.customerCity}<br/>
        Tel: ${order.customerPhone}
      </p>
      <p style="color:#888;font-size:13px">Si tienes dudas sobre tu pedido escríbenos por WhatsApp al <a href="https://wa.me/573213204299">321 320 4299</a>.</p>
      <p style="color:#888;font-size:13px">— Equipo Gorillaz Motorbikes</p>
    </div>`;

  const storeHtml = `
    <div style="font-family:sans-serif">
      <h2>Nuevo pedido — ${order.id}</h2>
      <p><strong>Cliente:</strong> ${order.customerName} &lt;${order.customerEmail}&gt; · ${order.customerPhone}</p>
      <p><strong>Dirección:</strong> ${order.customerAddress}, ${order.customerCity}</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 8px;text-align:left">Producto</th>
          <th style="padding:6px 8px;text-align:center">Cant.</th>
          <th style="padding:6px 8px;text-align:right">Total</th>
        </tr></thead>
        <tbody>${order.items.map(i => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${i.total.toLocaleString('es-CO')}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p><strong>Total:</strong> $${order.total.toLocaleString('es-CO')} COP</p>
    </div>`;

  const storeEmail = process.env.ORDERS_EMAIL || process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com';

  await Promise.allSettled([
    resendClient.emails.send({
      from: 'tienda@gorillazmotorbikes.com',
      to: order.customerEmail,
      subject: `Confirmación de pedido #${order.id.slice(0, 8).toUpperCase()} — Gorillaz Motorbikes`,
      html: clientHtml,
    }),
    resendClient.emails.send({
      from: 'tienda@gorillazmotorbikes.com',
      to: storeEmail,
      subject: `Nuevo pedido de ${order.customerName} — $${order.total.toLocaleString('es-CO')} COP`,
      html: storeHtml,
    }),
  ]);
}

const router = express.Router();

router.get('/tienda', (req, res) => {
  const allCats  = catalog.categories;
  const allProds = catalog.products;
  const priceVals  = (allProds || []).map(p => p.price).filter(n => Number.isFinite(n));
  const priceStats = { min: priceVals.length ? Math.min(...priceVals) : 0, max: priceVals.length ? Math.max(...priceVals) : 0 };
  const q           = (req.query.q    || '').toString().trim().toLowerCase();
  const selectedCat = (req.query.cat  || '').toString();
  const min         = Number.isFinite(parseInt(req.query.min, 10)) ? parseInt(req.query.min, 10) : null;
  const max         = Number.isFinite(parseInt(req.query.max, 10)) ? parseInt(req.query.max, 10) : null;
  const sort        = (req.query.sort || '').toString();

  let base = allProds.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))) return false;
    if (min !== null && p.price < min) return false;
    if (max !== null && p.price > max) return false;
    return true;
  });

  const categories = allCats.map(c => ({ ...c, count: base.filter(p => p.category === c.slug).length }));
  let products     = selectedCat ? base.filter(p => p.category === selectedCat) : base;
  if (sort === 'price-asc')  products = products.slice().sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') products = products.slice().sort((a, b) => b.price - a.price);

  const brands        = [...new Set((allProds || []).map(p => p.brand).filter(Boolean))].sort();
  const selectedBrand = (req.query.brand || '').toString();
  if (selectedBrand) products = products.filter(p => p.brand === selectedBrand);

  const qp = new URLSearchParams();
  if (q) qp.set('q', q); if (min !== null) qp.set('min', String(min)); if (max !== null) qp.set('max', String(max)); if (sort) qp.set('sort', sort);
  const baseQuery = qp.toString();

  const page       = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage    = 12;
  const totalPages = Math.ceil(products.length / perPage);
  const paginated  = products.slice((page - 1) * perPage, page * perPage);

  res.render('shop', { categories, products: paginated, allProductsCount: products.length, selectedCat, q, min: min ?? '', max: max ?? '', sort, baseQuery, priceStats, page, totalPages, brands, selectedBrand });
});

router.get('/tienda/:id', (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.status(404).render('404');
  const cat     = (catalog.categories || []).find(c => c.slug === product.category);
  const related = (catalog.products   || []).filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  res.render('shop-product', { product, category: cat, related });
});

router.post('/cart/add', cartLimiter, (req, res) => {
  const { id, qty } = req.body;
  const product = catalog.products.find(p => p.id === id);
  if (!product) return res.status(400).send('Producto no encontrado');
  const cart     = getCart(req);
  const q        = Math.max(1, parseInt(qty || '1', 10));
  const maxStock = typeof product.stock === 'number' ? product.stock : Infinity;
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (maxStock === 0) {
    if (wantsJSON) return res.status(400).json({ ok: false, message: 'Producto agotado' });
    return res.redirect('/carrito');
  }
  cart.items[id] = Math.min((cart.items[id] || 0) + q, maxStock);
  recalc(cart);
  saveCart(res, cart);
  if (wantsJSON) {
    const cartItems = Object.entries(cart.items).map(([itemId, itemQty]) => {
      const p = catalog.products.find(x => x.id === itemId);
      if (!p) return null;
      const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
      return { id: itemId, name: p.name, qty: itemQty, total: finalPrice * itemQty };
    }).filter(Boolean);
    return res.json({ ok: true, cartCount: cart.count, subtotal: cart.subtotal, cartItems, message: `${product.name} añadido al carrito` });
  }
  res.redirect('/carrito');
});

router.post('/cart/update', (req, res) => {
  const { id, qty } = req.body;
  const cart = getCart(req);
  const q    = Math.max(0, parseInt(qty || '0', 10));
  if (q === 0) delete cart.items[id]; else cart.items[id] = q;
  recalc(cart);
  saveCart(res, cart);
  res.redirect('/carrito');
});

router.post('/cart/clear', (req, res) => {
  const empty = { items: {}, count: 0, subtotal: 0 };
  req.cart = empty;
  saveCart(res, empty);
  res.redirect('/carrito');
});

router.get('/carrito', (req, res) => {
  const cart  = recalc(getCart(req));
  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    if (!p) { delete cart.items[id]; return null; }
    const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
    return { ...p, qty, unitPrice: finalPrice, total: finalPrice * qty };
  }).filter(Boolean);
  res.render('cart', { items, cart });
});

router.get('/checkout', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    if (!p) { delete cart.items[id]; return null; }
    const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
    return { ...p, qty, unitPrice: finalPrice, total: finalPrice * qty };
  }).filter(Boolean);
  res.render('checkout', { cart, items });
});

router.post('/pagar', async (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');

  const customerName    = (req.body.customer_name    || '').trim();
  const customerEmail   = (req.body.customer_email   || '').trim();
  const customerPhone   = (req.body.customer_phone   || '').trim();
  const customerCity    = (req.body.customer_city    || '').trim();
  const customerAddress = (req.body.customer_address || '').trim();

  if (!customerName || !customerEmail || !customerPhone || !customerCity || !customerAddress) {
    const items = Object.entries(cart.items).map(([id, qty]) => {
      const p = catalog.products.find(x => x.id === id);
      if (!p) return null;
      const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
      return { ...p, qty, unitPrice: finalPrice, total: finalPrice * qty };
    }).filter(Boolean);
    return res.status(400).render('checkout', {
      cart, items,
      error: 'Por favor completa todos los campos de contacto y envío.',
    });
  }

  // Validar stock antes de procesar el pago
  const stockErrors = [];
  for (const [id, qty] of Object.entries(cart.items)) {
    const p = catalog.products.find(x => x.id === id);
    if (!p) { stockErrors.push(`Producto no encontrado (${id})`); continue; }
    if (typeof p.stock === 'number' && p.stock === 0) {
      stockErrors.push(`"${p.name}" está agotado`);
    } else if (typeof p.stock === 'number' && qty > p.stock) {
      stockErrors.push(`"${p.name}": solo quedan ${p.stock} unidades (tienes ${qty} en el carrito)`);
    }
  }

  if (stockErrors.length > 0) {
    const items = Object.entries(cart.items).map(([id, qty]) => {
      const p = catalog.products.find(x => x.id === id);
      if (!p) return null;
      const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
      return { ...p, qty, unitPrice: finalPrice, total: finalPrice * qty };
    }).filter(Boolean);
    return res.status(409).render('checkout', {
      cart, items,
      error: `No se puede procesar el pedido: ${stockErrors.join('; ')}. Actualiza tu carrito e intenta de nuevo.`,
    });
  }

  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    if (!p) return null;
    const finalPrice = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
    return { id, name: p.name, qty, unitPrice: finalPrice, total: finalPrice * qty };
  }).filter(Boolean);

  const orderId = uuidv4();

  try {
    await createOrder({
      id: orderId,
      userId: req.userId || null,
      boldOrderId: orderId,
      status: 'pending',
      total: cart.subtotal,
      items,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerCity,
    });

    const payload = await createBoldPaymentLink({
      orderId,
      totalCOP: cart.subtotal,
      description: `Compra en Gorillaz Motorbikes (${cart.count} artículo${cart.count !== 1 ? 's' : ''})`,
    });

    res.cookie('bold_pending', JSON.stringify({ orderId, total: cart.subtotal }), {
      httpOnly: true,
      maxAge: 35 * 60 * 1000,
      sameSite: 'lax',
    });

    return res.redirect(payload.payment_link);
  } catch (err) {
    console.error('[Bold] Error creando enlace de pago:', err.message);
    return res.status(502).render('payment/failed', { reason: 'No fue posible conectar con la pasarela de pago. Intenta de nuevo.' });
  }
});

// Bold redirige aquí tras el pago: /payment/return?bold-order-id=xxx&bold-tx-status=APPROVED
router.get('/payment/return', (req, res) => {
  const status  = (req.query['bold-tx-status']  || '').toUpperCase();
  const boldId  = req.query['bold-order-id']    || '';
  const sigHash = req.query['bold-signature']   || '';

  let pending = null;
  try { pending = JSON.parse(req.cookies.bold_pending || 'null'); } catch (_) {}

  // Limpiar cookie de pendiente
  res.clearCookie('bold_pending');

  if (status === 'APPROVED') {
    if (sigHash && pending && !verifyBoldSignature(boldId, status, pending.total, sigHash)) {
      console.warn('[Bold] Firma inválida en retorno de pago');
      return res.status(400).render('payment/failed', { reason: 'No se pudo verificar el pago. Contacta soporte.' });
    }
    if (pending?.orderId) {
      updateOrderStatus(pending.orderId, 'paid', boldId)
        .then(() => claimStockDecrement(pending.orderId))
        .then(claimed => { if (claimed) return getOrderById(pending.orderId); })
        .then(async order => { if (order) { await decrementStock(order.items); sendOrderConfirmationEmails(order); } })
        .catch(e => console.error('[Orders] post-payment error:', e.message));
    }
    const empty = { items: {}, count: 0, subtotal: 0 };
    saveCart(res, empty);
    return res.render('payment/success', {
      orderId: pending?.orderId || boldId,
      total: pending?.total || 0,
    });
  }

  if (status === 'PENDING') {
    if (pending?.orderId) {
      updateOrderStatus(pending.orderId, 'pending_confirmation', boldId).catch(e => console.error('[Orders] updateOrderStatus pending:', e.message));
    }
    return res.render('payment/failed', { reason: 'Tu pago está pendiente de confirmación. Te notificaremos por email cuando se procese.' });
  }

  if (pending?.orderId) {
    updateOrderStatus(pending.orderId, 'failed', boldId).catch(e => console.error('[Orders] updateOrderStatus failed:', e.message));
  }
  return res.render('payment/failed', { reason: 'El pago fue rechazado o cancelado. Tu carrito sigue guardado.' });
});

// Webhook server-to-server de Bold — no requiere CSRF ni redirect del browser
router.post('/payment/webhook', async (req, res) => {
  const { order_id, status, amount, signature } = req.body || {};

  if (!order_id || !status) {
    return res.status(400).json({ ok: false, message: 'Payload inválido' });
  }

  const normalizedStatus = (status || '').toUpperCase();
  const totalAmount = amount?.total_amount ?? amount ?? 0;

  // Siempre se exige firma válida: sin secreto configurado o sin firma en el
  // payload se rechaza, para que nadie pueda marcar una orden como pagada
  // enviando un POST sin firma a este endpoint (exento de CSRF).
  if (!BOLD_SECRET_KEY || !signature || !verifyBoldSignature(order_id, normalizedStatus, totalAmount, signature)) {
    console.warn('[Bold Webhook] Firma inválida o ausente para orden', order_id);
    return res.status(401).json({ ok: false, message: 'Firma inválida' });
  }

  try {
    let newStatus;
    if (normalizedStatus === 'APPROVED')       newStatus = 'paid';
    else if (normalizedStatus === 'PENDING')   newStatus = 'pending_confirmation';
    else                                        newStatus = 'failed';

    await updateOrderStatus(order_id, newStatus, order_id);

    if (newStatus === 'paid') {
      const claimed = await claimStockDecrement(order_id);
      const order = await getOrderById(order_id);
      if (order) {
        if (claimed) await decrementStock(order.items);
        sendOrderConfirmationEmails(order).catch(e => console.error('[Bold Webhook] email error:', e.message));
      }
    }

    console.log(`[Bold Webhook] Orden ${order_id} → ${newStatus}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Bold Webhook] Error:', err.message);
    return res.status(500).json({ ok: false, message: 'Error interno' });
  }
});

module.exports = router;

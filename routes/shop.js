'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');
const catalog  = require('../data/catalog');
const { getCart, recalc, saveCart } = require('../helpers/cart');
const { BOLD_API_KEY, BOLD_SECRET_KEY, BOLD_REDIRECT_URL } = require('../config');

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

router.post('/cart/add', (req, res) => {
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
  if (wantsJSON) return res.json({ ok: true, cartCount: cart.count, message: `${product.name} añadido al carrito` });
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
    return { ...p, qty, total: p.price * qty };
  });
  res.render('cart', { items, cart });
});

router.get('/checkout', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  res.render('checkout', { cart });
});

router.post('/pagar', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  const orderId = uuidv4();
  const total   = cart.subtotal;
  const empty   = { items: {}, count: 0, subtotal: 0 };
  req.cart = empty;
  saveCart(res, empty);
  res.render('payment/success', { orderId, total });
});

module.exports = router;

'use strict';
// Carrito en cookie. Solo guarda qué y cuánto (nunca precios): el precio se
// recalcula siempre en el servidor con helpers/shop/pricing.js.
//
// Formato: { items: { <clave>: qty }, install: { <clave>: true } }
// La clave es el id del producto o "<idProducto>~<idVariante>".

const { catalog, findById, isPublic } = require('./catalog');
const { computeCart } = require('./shop/pricing');

const MAX_QTY = 99;

const makeKey = (productId, variantId) => (variantId ? `${productId}~${variantId}` : String(productId));
function parseKey(key) {
  const [productId, variantId] = String(key).split('~');
  return { productId, variantId: variantId || null };
}

const emptyCart = () => ({ items: {}, install: {} });

const getCart = (req) => {
  if (!req.cart) req.cart = emptyCart();
  if (!req.cart.items || typeof req.cart.items !== 'object') req.cart.items = {};
  if (!req.cart.install || typeof req.cart.install !== 'object') req.cart.install = {};
  return req.cart;
};

// Miembro del club = sesión iniciada con membresía vigente (si tiene vencimiento).
function isClubMember(user) {
  if (!user || user.deletedAt) return false;
  const exp = user.membership && user.membership.expires;
  if (exp && Number.isFinite(Date.parse(exp)) && Date.parse(exp) < Date.now()) return false;
  return true;
}

// Stock disponible para una línea (null = no se controla).
function availableStock(product, variant) {
  if (variant) return variant.stock;
  if (product.variants && product.variants.length) return 0; // exige elegir variante
  return product.stock;
}

// Convierte la cookie en líneas con su producto/variante. Descarta lo que ya no
// existe o no está publicado, y recorta cantidades al stock disponible.
function resolveLines(cart) {
  const lines = [];
  for (const [key, rawQty] of Object.entries(cart.items || {})) {
    const { productId, variantId } = parseKey(key);
    const product = findById(productId);
    if (!product || !isPublic(product)) continue;
    const variant = variantId ? (product.variants || []).find((v) => v.id === variantId) || null : null;
    if (variantId && !variant) continue;
    if (!variant && product.variants && product.variants.length) continue;
    let qty = Math.min(MAX_QTY, Math.max(0, parseInt(rawQty, 10) || 0));
    const stock = availableStock(product, variant);
    if (typeof stock === 'number') qty = Math.min(qty, stock);
    if (qty <= 0) continue;
    lines.push({ key, product, variant, qty, install: !!(cart.install || {})[key] });
  }
  return lines;
}

// Carrito calculado listo para pintar o cobrar.
function priceCart(cart, { user = null, coupon = null, delivery = null } = {}) {
  return computeCart({
    lines: resolveLines(cart),
    combos: catalog.combos,
    member: isClubMember(user),
    coupon,
    delivery,
  });
}

// Deja la cookie solo con líneas válidas (tras recortar stock o borrar).
function normalizeCart(cart) {
  const lines = resolveLines(cart);
  const next = emptyCart();
  for (const l of lines) {
    next.items[l.key] = l.qty;
    if (l.install) next.install[l.key] = true;
  }
  return next;
}

const saveCart = (res, cart) => {
  const clean = { items: cart.items || {}, install: cart.install || {} };
  res.cookie('cart', JSON.stringify(clean), { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax' });
};

module.exports = { MAX_QTY, makeKey, parseKey, emptyCart, getCart, isClubMember, availableStock, resolveLines, priceCart, normalizeCart, saveCart };

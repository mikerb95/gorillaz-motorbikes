'use strict';
const catalog = require('../data/catalog');

const getCart = (req) => {
  if (!req.cart) req.cart = { items: {}, count: 0, subtotal: 0 };
  return req.cart;
};

const recalc = (cart) => {
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(cart.items)) {
    const prod = catalog.products.find(p => p.id === id);
    if (prod) { count += qty; subtotal += prod.price * qty; }
  }
  cart.count = count; cart.subtotal = subtotal; return cart;
};

const saveCart = (res, cart) => {
  res.cookie('cart', JSON.stringify(cart), { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
};

module.exports = { getCart, recalc, saveCart };

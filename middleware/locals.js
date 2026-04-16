'use strict';
const jwt     = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { getUserById, getAllEvents } = require('../db');
const catalog = require('../data/catalog');

const jwtCart = (req, res, next) => {
  const token = req.cookies.jwt;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.id;
    } catch {
      req.userId = null;
    }
  }

  req.cart = { items: {}, count: 0, subtotal: 0 };
  if (req.cookies.cart) {
    try {
      const parsed = JSON.parse(req.cookies.cart);
      if (parsed && typeof parsed.items === 'object' && !Array.isArray(parsed.items)) {
        req.cart = parsed;
      } else {
        res.clearCookie('cart');
      }
    } catch {
      res.clearCookie('cart');
    }
  }
  next();
};

const templateLocals = async (req, res, next) => {
  if (req.userId) {
    try { res.locals.user = await getUserById(req.userId); }
    catch { res.locals.user = null; }
  } else {
    res.locals.user = null;
  }

  const c = req.cart || { items: {}, count: 0, subtotal: 0 };
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(c.items || {})) {
    const prod = (catalog.products || []).find(p => p.id === id);
    if (prod) { count += qty; subtotal += prod.price * qty; }
  }
  res.locals.cart = { items: c.items || {}, count, subtotal };
  try {
    res.locals.cartItems = Object.entries(c.items || {}).map(([id, qty]) => {
      const p = (catalog.products || []).find(pp => pp.id === id);
      return p ? { id, name: p.name, qty, total: (p.price || 0) * qty } : null;
    }).filter(Boolean);
  } catch { res.locals.cartItems = []; }

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const events = await getAllEvents();
    let evCount = 0; let firstIdx = -1;
    (events || []).forEach((ev, i) => {
      if (!ev || !ev.date) return;
      const t = Date.parse(ev.date);
      if (!Number.isFinite(t)) return;
      const d = new Date(t); d.setHours(0, 0, 0, 0);
      if (d >= today) { evCount++; if (firstIdx === -1) firstIdx = i; }
    });
    res.locals.eventsUpcoming    = evCount;
    res.locals.eventsFirstAnchor = firstIdx >= 0 ? ('#ev-' + firstIdx) : '';
  } catch {
    res.locals.eventsUpcoming    = 0;
    res.locals.eventsFirstAnchor = '';
  }
  next();
};

module.exports = { jwtCart, templateLocals };

'use strict';
const jwt     = require('jsonwebtoken');
const { JWT_SECRET, RECAPTCHA_SITE_KEY } = require('../config');
const { getUserById, getAllEvents } = require('../db');
const catalog = require('../data/catalog');
const { readFlash } = require('../helpers/flash');
const { fechaCO, horaCO, fechaHoraCO } = require('../helpers/datetime');

const jwtCart = (req, res, next) => {
  const token = req.cookies.jwt;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.id;
      req.tokenVersion = decoded.tv ?? 0;
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
    try {
      const u = await getUserById(req.userId);
      // Revocación de sesión: el token debe coincidir con el token_version actual
      // del usuario. Si no (contraseña cambiada, cuenta eliminada) o el usuario ya
      // no existe, se invalida la sesión y se limpia la cookie.
      if (u && (u.tokenVersion || 0) === (req.tokenVersion || 0)) {
        res.locals.user = u;
      } else {
        req.userId = null;
        res.locals.user = null;
        res.clearCookie('jwt');
      }
    } catch { res.locals.user = null; }
  } else {
    res.locals.user = null;
  }

  // Disponible para todas las plantillas; el widget solo se pinta si hay clave.
  res.locals.recaptchaSiteKey = RECAPTCHA_SITE_KEY;

  // Formateadores de fecha/hora en hora Colombia para todas las vistas EJS.
  // Convierten los timestamps UTC de la BD a America/Bogota (UTC−5).
  res.locals.fechaCO     = fechaCO;
  res.locals.horaCO      = horaCO;
  res.locals.fechaHoraCO = fechaHoraCO;

  const c = req.cart || { items: {}, count: 0, subtotal: 0 };
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(c.items || {})) {
    const prod = (catalog.products || []).find(p => p.id === id);
    if (prod) {
      count += qty;
      const finalPrice = prod.discount > 0 ? Math.round(prod.price * (1 - prod.discount / 100)) : prod.price;
      subtotal += finalPrice * qty;
    }
  }
  res.locals.cart = { items: c.items || {}, count, subtotal };
  try {
    res.locals.cartItems = Object.entries(c.items || {}).map(([id, qty]) => {
      const p = (catalog.products || []).find(pp => pp.id === id);
      return p ? { id, name: p.name, qty, total: Math.round(p.price * (1 - (p.discount || 0) / 100)) * qty } : null;
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
  res.locals.flash = readFlash(req, res);
  next();
};

module.exports = { jwtCart, templateLocals };

'use strict';
const jwt     = require('jsonwebtoken');
const { JWT_SECRET, RECAPTCHA_SITE_KEY } = require('../config');
const { getUserById, getAllEvents } = require('../db');
const navMenu = require('../data/nav-menu');
const { getCart, priceCart, isClubMember } = require('../helpers/cart');
const { visibleCategories } = require('../helpers/catalog');
const { getBusiness, openStatus, hoursSummary } = require('../helpers/business');
const { fmtCOP, fmtPesos } = require('../helpers/money');
const { waLink, waShareLink, messages: waMsg } = require('../helpers/whatsapp');
const { SITE_URL } = require('../helpers/seo');
const { readFlash } = require('../helpers/flash');
const { fechaCO, horaCO, fechaHoraCO } = require('../helpers/datetime');
const { assetVersion } = require('../helpers/assets');

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

// Páginas personales o de uso interno: se marcan noindex para que no compitan
// con las públicas ni expongan órdenes, facturas o cotizaciones en Google.
const PRIVATE_PATHS = [
  /^\/club\/./, /^\/admin/, /^\/taller/, /^\/kds/, /^\/liquidador/,
  /^\/cotizacion\//, /^\/factura\//, /^\/mi-orden/, /^\/historial/, /^\/checkin/,
  /^\/carrito/, /^\/checkout/, /^\/payment\//, /^\/control/, /^\/clases\//,
  /^\/clasificados\/(mios|nuevo)$/, /^\/clasificados\/[^/]+\/editar$/,
  /^\/newsletter\//, /^\/resenas$/,
];

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

  // SEO: cada página declara su propia URL canónica (sin query ni barra final).
  // Antes las rutas que no pasaban canonicalPath apuntaban a la home y Google
  // las trataba como duplicados. Una ruta puede sobrescribirlo al renderizar.
  const p = req.path.length > 1 ? req.path.replace(/\/+$/, '') : '/';
  res.locals.canonicalPath = p;
  res.locals.noIndex = PRIVATE_PATHS.some(re => re.test(p));

  // Disponible para todas las plantillas; el widget solo se pinta si hay clave.
  res.locals.recaptchaSiteKey = RECAPTCHA_SITE_KEY;

  // Cache-busting para /static/* (servido con cache-control immutable de 1 año).
  res.locals.assetV = assetVersion;

  // Menú de la navbar (escritorio y móvil salen de la misma lista).
  res.locals.navMenu = navMenu;

  // Formateadores de fecha/hora en hora Colombia para todas las vistas EJS.
  // Convierten los timestamps UTC de la BD a America/Bogota (UTC−5).
  res.locals.fechaCO     = fechaCO;
  res.locals.horaCO      = horaCO;
  res.locals.fechaHoraCO = fechaHoraCO;

  // Minicarrito del header: mismo cálculo que el carrito y el checkout, sobre
  // el catálogo vivo (antes leía el seed y podía mostrar precios viejos).
  try {
    const priced = priceCart(getCart(req), { user: res.locals.user });
    res.locals.cart = { items: req.cart.items, count: priced.count, subtotal: priced.merchandise };
    res.locals.cartItems = priced.lines.map(l => ({ id: l.key, name: l.name, qty: l.qty, total: l.lineTotal }));
  } catch {
    res.locals.cart = { items: {}, count: 0, subtotal: 0 };
    res.locals.cartItems = [];
  }
  res.locals.isClubMember = isClubMember(res.locals.user);

  // Negocio, precios, WhatsApp y SEO para todas las vistas.
  const biz = getBusiness();
  res.locals.biz = biz;
  res.locals.bizOpen = openStatus(biz);
  res.locals.bizHours = hoursSummary(biz);
  res.locals.fmtCOP = fmtCOP;
  res.locals.fmtPesos = fmtPesos;
  res.locals.waLink = waLink;
  res.locals.waShareLink = waShareLink;
  res.locals.waMsg = waMsg;
  res.locals.siteUrl = SITE_URL;
  // Canonical por defecto: la ruta propia sin query (nunca el home). Las vistas
  // que necesitan otro (filtros, paginación) lo sobreescriben.
  res.locals.canonicalPath = req.path;
  try { res.locals.shopNavCategories = visibleCategories(); } catch { res.locals.shopNavCategories = []; }

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

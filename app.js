'use strict';
const express = require('express');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const multer = require('multer');
const https = require('https');
const QRCode = require('qrcode');

const {
  initDb,
  getUserById, getUserByEmail, getUserByCedula, getUserByResetToken,
  getAllUsers, countUsers, createUser, updateUser, deleteUser,
  addUserScore, getLeaderboard,
  getAllAppointments, getAppointmentDates, countAppointments,
  createAppointment, updateAppointment, deleteAppointment,
  getAllEvents, countEvents, createEvent, getEventById, updateEvent, deleteEvent,
  getUpcomingEvents,
  registerEventAttendance, hasUserAttendedEvent, getEventAttendances,
  confirmEventAttendance, getUserEventRegistrations,
  getNewsletterByEmail, createNewsletter,
  createEnrollment,
  createJobApplication,
} = require('./db');

const catalog = require('./data/catalog');
const courses = require('./data/courses.json');
const classesData = require('./data/classes.json');

const app = express();

// Initialize DB schema on startup (idempotent)
initDb().catch(err => console.error('❌ DB init error:', err));

// ── Multer: product image uploads ─────────────────────────────────────────

const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'images', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});
const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|avif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
}).array('images', 5);

// ── Constants ─────────────────────────────────────────────────────────────

const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET not set — using insecure fallback. Set this env var in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-fallback';

const resendClient = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_to_prevent_crash_123');

// ── Middleware ────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || JWT_SECRET));

// CSRF token
app.use((req, res, next) => {
  if (!req.cookies._csrf) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('_csrf', token, { httpOnly: false, sameSite: 'strict', maxAge: 3600000 });
    res.locals.csrfToken = token;
  } else {
    res.locals.csrfToken = req.cookies._csrf;
  }
  next();
});

// JWT + cart (cookie-based, no session needed)
app.use((req, res, next) => {
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
});

// Static files
app.use('/static',   express.static(path.join(__dirname, 'public')));
app.use('/favicons', express.static(path.join(__dirname, 'favicons')));
app.use('/images',   express.static(path.join(__dirname, 'images')));

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Locals for templates
app.use(async (req, res, next) => {
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

  // Upcoming events badge
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
    res.locals.eventsUpcoming = evCount;
    res.locals.eventsFirstAnchor = firstIdx >= 0 ? ('#ev-' + firstIdx) : '';
  } catch {
    res.locals.eventsUpcoming = 0;
    res.locals.eventsFirstAnchor = '';
  }
  next();
});

// CSRF validation
const validateCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.body._csrf || req.headers['x-csrf-token'];
  const cookieToken = req.cookies._csrf;
  if (!token || token !== cookieToken) {
    return res.status(403).render('403', { message: 'Token CSRF inválido. Actualiza la página e inténtalo de nuevo.' });
  }
  next();
};
app.use(validateCsrf);

// Auth guards
const requireAuth = (req, res, next) => {
  if (!req.userId) return res.redirect('/club/login');
  next();
};
const requireAdmin = (req, res, next) => {
  const u = res.locals.user;
  if (!u || u.role !== 'admin') return res.status(403).render('404');
  next();
};

// ── Admin data (availability stored as JSON file — non-critical) ──────────

let availability = { blockedDates: [] };
try { availability = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'availability.json'), 'utf8')); } catch { }

const saveJSON = (file, data) => {
  try { fs.writeFileSync(path.join(__dirname, 'data', file), JSON.stringify(data, null, 2), 'utf8'); } catch { }
};
const writeCatalog = (obj) => {
  try {
    const file = path.join(__dirname, 'data', 'catalog.js');
    fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(obj, null, 2) + ' ;\n', 'utf8');
  } catch { }
};

// ── Cart helpers ──────────────────────────────────────────────────────────

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

// ── Helper: demand map ────────────────────────────────────────────────────

async function computeDemandMap() {
  const demand = {};
  const appointments = await getAppointmentDates();
  appointments.forEach(a => {
    if (!a.date) return;
    const d = a.date.slice(0, 10);
    demand[d] = (demand[d] || 0) + 1;
  });
  if (availability && availability.occupationLevels) {
    Object.entries(availability.occupationLevels).forEach(([d, lvl]) => {
      if (lvl === 'high') demand[d] = Math.max(demand[d] || 0, 8);
      else if (lvl === 'medium') demand[d] = Math.max(demand[d] || 0, 4);
    });
  }
  const result = {};
  Object.entries(demand).forEach(([d, c]) => {
    result[d] = c >= 6 ? 'high' : c >= 3 ? 'medium' : 'low';
  });
  return result;
}

// ── reCAPTCHA verification ────────────────────────────────────────────────

const verifyRecaptcha = (token, ip) => new Promise((resolve) => {
  if (!RECAPTCHA_SECRET_KEY) return resolve(true);
  const data = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token || '', remoteip: ip || '' }).toString();
  const opts = { hostname: 'www.google.com', path: '/recaptcha/api/siteverify', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
  const r = https.request(opts, resp => {
    let body = '';
    resp.on('data', d => body += d);
    resp.on('end', () => { try { resolve(!!JSON.parse(body).success); } catch { resolve(false); } });
  });
  r.on('error', () => resolve(false));
  r.write(data); r.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ── Home ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const slidesDirWebp = path.join(__dirname, 'images', 'slideshow', 'WEBP');
  const slidesDir = path.join(__dirname, 'images', 'slideshow');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  const readSlides = (dir, urlPrefix) => {
    try {
      return fs.readdirSync(dir).filter(f => allowed.has(path.extname(f).toLowerCase())).sort().map(f => `${urlPrefix}/${encodeURIComponent(f)}`);
    } catch { return []; }
  };
  let slides = readSlides(slidesDirWebp, '/images/slideshow/WEBP');
  if (!slides.length) slides = readSlides(slidesDir, '/images/slideshow');

  // Flash messages via query param
  const flash = req.query.flash || null;
  const newsletterStatus = flash === 'ok' ? 'ok' : flash === 'error' ? 'error' : flash === 'captcha' ? 'captcha' : null;

  res.render('home', { slides, newsletterStatus, recaptchaSiteKey: RECAPTCHA_SITE_KEY });
});

// ── Servicios ─────────────────────────────────────────────────────────────

app.get('/servicios/agendar', async (req, res) => {
  const services = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];
  res.render('services_schedule', { services, bookingMessage: null, demandMap: await computeDemandMap() });
});

app.post('/servicios/agendar', async (req, res) => {
  const { name, email, phone, service, date } = req.body;
  const services = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];
  const demandMap = await computeDemandMap();
  if (!name || !service || !date || !email) {
    return res.render('services_schedule', { services, bookingMessage: 'Por favor completa todos los campos.', demandMap });
  }
  const formattedDate = new Date(date).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await createAppointment({ id: uuidv4(), name, email, phone, service, date, status: 'pendiente' });
  try {
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_TU_API_KEY_AQUI') {
      const clientHtml = `<p>Hola <strong>${name}</strong>,</p><p>Hemos recibido tu solicitud de cita para <strong>${service}</strong> el <strong>${formattedDate}</strong>.</p><p>Nuestro equipo te contactará al número <strong>${phone}</strong> para confirmar la cita.</p><p>Gracias por confiar en Gorillaz Motorbikes.</p>`;
      const bookingHtml = `<p><strong>Nueva solicitud de cita</strong></p><ul><li><strong>Cliente:</strong> ${name}</li><li><strong>Email:</strong> ${email}</li><li><strong>Teléfono:</strong> ${phone}</li><li><strong>Servicio:</strong> ${service}</li><li><strong>Fecha solicitada:</strong> ${formattedDate}</li></ul>`;
      await Promise.allSettled([
        resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: email, subject: `Confirmación de cita — ${service}`, html: clientHtml }),
        resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com', subject: `Nueva cita: ${service} — ${name}`, html: bookingHtml }),
      ]);
    }
  } catch (e) { console.error('Resend error:', e.message); }
  res.render('services_schedule', { services, bookingMessage: `Gracias ${name}. Confirmación enviada a ${email}. Te contactaremos al ${phone}.`, demandMap: await computeDemandMap() });
});

app.get('/servicios/lavado-motos',    (req, res) => res.render('services/lavado-motos'));
app.get('/servicios/lavado-cascos',   (req, res) => res.render('services/lavado-cascos'));
app.get('/servicios/detailing-motos', (req, res) => res.render('services/detailing-motos'));

app.get('/servicios', (req, res) => {
  const services = [
    { slug: 'lavado-motos',               title: 'Lavado de motos',               desc: 'Limpieza profunda con productos especializados para cuidar la pintura y componentes de tu máquina.',                   img: '/images/services/lavado-motos.png' },
    { slug: 'lavado-cascos',              title: 'Lavado de cascos',              desc: 'Desinfección y limpieza interna y externa para mantener tu seguridad y confort al rodar.',                           img: '/images/services/lavado-cascos.webp' },
    { slug: 'detailing-motos',            title: 'Detailing de motos',            desc: 'Restauración estética detallada, polichado y protección cerámica para un brillo único.',                            img: '/images/services/detailing-motos.webp' },
    { slug: 'mecanica',                   title: 'Mecánica',                      desc: 'Diagnóstico, mantenimiento preventivo y correctivo. Trabajamos con control de calidad para que tu moto rinda al máximo.', img: '/images/services/mecanica.webp' },
    { slug: 'pintura',                    title: 'Pintura',                       desc: 'Acabados profesionales, retoques y protección. Cuidamos el detalle y la durabilidad.',                              img: '/images/services/pintura.webp' },
    { slug: 'alistamiento-tecnomecanica', title: 'Alistamiento tecnomecánica',    desc: 'Revisión integral y ajustes previos a la inspección para evitar sorpresas y rechazos.',                            img: '/images/services/alistamiento.webp' },
    { slug: 'electricidad',               title: 'Electricidad',                  desc: 'Sistema de carga, arranque e iluminación. Diagnóstico electrónico confiable.',                                      img: '/images/services/electricidad.webp' },
    { slug: 'torno',                      title: 'Torno',                         desc: 'Fabricación y ajuste de componentes a medida según especificación.',                                                 img: '/images/services/torno.webp' },
    { slug: 'prensa',                     title: 'Prensa',                        desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.',                                                     img: '/images/services/prensa.webp' },
    { slug: 'mecanica-rapida',            title: 'Mecánica rápida',               desc: 'Servicios ágiles como cambios de aceite y ajustes menores con cita.',                                               img: '/images/services/mecanica-rapida.webp' },
    { slug: 'escaneo-de-motos',           title: 'Escaneo de motos',              desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.',                                        img: '/images/services/scaneo.webp' },
  ];
  res.render('services', { services });
});

app.get(['/agendar-servicio', '/servicios/agenda', '/agenda-servicio', '/agenda'], (req, res) => res.redirect('/servicios/agendar'));

// ── Tienda ────────────────────────────────────────────────────────────────

app.get('/tienda', (req, res) => {
  const allCats = catalog.categories;
  const allProds = catalog.products;
  const priceVals = (allProds || []).map(p => p.price).filter(n => Number.isFinite(n));
  const priceStats = { min: priceVals.length ? Math.min(...priceVals) : 0, max: priceVals.length ? Math.max(...priceVals) : 0 };
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const selectedCat = (req.query.cat || '').toString();
  const min = Number.isFinite(parseInt(req.query.min, 10)) ? parseInt(req.query.min, 10) : null;
  const max = Number.isFinite(parseInt(req.query.max, 10)) ? parseInt(req.query.max, 10) : null;
  const sort = (req.query.sort || '').toString();

  let base = allProds.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))) return false;
    if (min !== null && p.price < min) return false;
    if (max !== null && p.price > max) return false;
    return true;
  });

  const categories = allCats.map(c => ({ ...c, count: base.filter(p => p.category === c.slug).length }));
  let products = selectedCat ? base.filter(p => p.category === selectedCat) : base;
  if (sort === 'price-asc') products = products.slice().sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') products = products.slice().sort((a, b) => b.price - a.price);

  const brands = [...new Set((allProds || []).map(p => p.brand).filter(Boolean))].sort();
  const selectedBrand = (req.query.brand || '').toString();
  if (selectedBrand) products = products.filter(p => p.brand === selectedBrand);

  const qp = new URLSearchParams();
  if (q) qp.set('q', q); if (min !== null) qp.set('min', String(min)); if (max !== null) qp.set('max', String(max)); if (sort) qp.set('sort', sort);
  const baseQuery = qp.toString();

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = 12;
  const totalPages = Math.ceil(products.length / perPage);
  const paginated = products.slice((page - 1) * perPage, page * perPage);

  res.render('shop', { categories, products: paginated, allProductsCount: products.length, selectedCat, q, min: min ?? '', max: max ?? '', sort, baseQuery, priceStats, page, totalPages, brands, selectedBrand });
});

app.get('/tienda/:id', (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.status(404).render('404');
  const cat = (catalog.categories || []).find(c => c.slug === product.category);
  const related = (catalog.products || []).filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  res.render('shop-product', { product, category: cat, related });
});

// ── Carrito ───────────────────────────────────────────────────────────────

app.post('/cart/add', (req, res) => {
  const { id, qty } = req.body;
  const product = catalog.products.find(p => p.id === id);
  if (!product) return res.status(400).send('Producto no encontrado');
  const cart = getCart(req);
  const q = Math.max(1, parseInt(qty || '1', 10));
  const maxStock = typeof product.stock === 'number' ? product.stock : Infinity;
  if (maxStock === 0) {
    const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
    if (wantsJSON) return res.status(400).json({ ok: false, message: 'Producto agotado' });
    return res.redirect('/carrito');
  }
  cart.items[id] = Math.min((cart.items[id] || 0) + q, maxStock);
  recalc(cart);
  saveCart(res, cart);
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (wantsJSON) return res.json({ ok: true, cartCount: cart.count, message: `${product.name} añadido al carrito` });
  res.redirect('/carrito');
});

app.post('/cart/update', (req, res) => {
  const { id, qty } = req.body;
  const cart = getCart(req);
  const q = Math.max(0, parseInt(qty || '0', 10));
  if (q === 0) delete cart.items[id]; else cart.items[id] = q;
  recalc(cart);
  saveCart(res, cart);
  res.redirect('/carrito');
});

app.post('/cart/clear', (req, res) => {
  const empty = { items: {}, count: 0, subtotal: 0 };
  req.cart = empty;
  saveCart(res, empty);
  res.redirect('/carrito');
});

app.get('/carrito', (req, res) => {
  const cart = recalc(getCart(req));
  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    return { ...p, qty, total: p.price * qty };
  });
  res.render('cart', { items, cart });
});

app.get('/checkout', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  res.render('checkout', { cart });
});

app.post('/pagar', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  const orderId = uuidv4();
  const total = cart.subtotal;
  const empty = { items: {}, count: 0, subtotal: 0 };
  req.cart = empty;
  saveCart(res, empty);
  res.render('payment/success', { orderId, total });
});

// ── Cursos ────────────────────────────────────────────────────────────────

app.get('/cursos', (req, res) => res.render('courses', { list: courses }));

app.get('/cursos/:slug', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.render('course', { course, enrollStatus: req.query.status || null });
});

app.get('/cursos/:slug/inscripcion', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.redirect(`/cursos/${encodeURIComponent(req.params.slug)}#inscripcion`);
});

app.post('/cursos/:slug/inscripcion', async (req, res) => {
  const slug = req.params.slug;
  const course = courses.find(c => c.slug === slug);
  if (!course) return res.status(404).render('404');
  const name  = (req.body.name  || '').toString().trim();
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const phone = (req.body.phone || '').toString().trim();
  const notes = (req.body.notes || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) {
    return res.redirect(`/cursos/${encodeURIComponent(slug)}?status=error#inscripcion`);
  }
  await createEnrollment({ id: uuidv4(), slug, courseTitle: course.title, name, email, phone, notes });
  res.redirect(`/cursos/${encodeURIComponent(slug)}?status=ok#inscripcion`);
});

// ── Eventos ───────────────────────────────────────────────────────────────

app.get('/eventos', async (req, res) => {
  const events = await getAllEvents();
  res.render('events', { events });
});

// ── Admin ─────────────────────────────────────────────────────────────────

app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const [users, events, citas] = await Promise.all([countUsers(), countEvents(), countAppointments()]);
  res.render('admin/index', { stats: { users, events, citas, cursos: courses.length, productos: (catalog.products || []).length } });
});

// Admin: calendario de disponibilidad
app.get('/admin/calendario', requireAuth, requireAdmin, (req, res) => res.render('admin/calendar', { availability }));

app.post('/admin/calendario/bloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  if (date && !availability.blockedDates.includes(date)) { availability.blockedDates.push(date); saveJSON('availability.json', availability); }
  res.redirect('/admin/calendario');
});

app.post('/admin/calendario/desbloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  availability.blockedDates = availability.blockedDates.filter(d => d !== date);
  saveJSON('availability.json', availability);
  res.redirect('/admin/calendario');
});

// Admin: eventos CRUD
app.get('/admin/eventos', requireAuth, requireAdmin, async (req, res) => {
  const events = await getAllEvents();
  res.render('admin/events', { events });
});

app.post('/admin/eventos/crear', requireAuth, requireAdmin, async (req, res) => {
  const { title, date, location, description } = req.body;
  if (title && date) await createEvent({ id: uuidv4(), title, date, location, description });
  res.redirect('/admin/eventos');
});

app.post('/admin/eventos/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, title, date, location, description } = req.body;
  await updateEvent(id, { title, date, location, description });
  res.redirect('/admin/eventos');
});

app.post('/admin/eventos/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteEvent(req.body.id);
  res.redirect('/admin/eventos');
});

// Admin: usuarios CRUD
app.get('/admin/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.render('admin/users', { users });
});

app.post('/admin/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, membershipLevel } = req.body;
  const u = await getUserById(id);
  if (u) {
    const fields = {};
    if (name) fields.name = name;
    if (membershipLevel) fields.membership = { ...u.membership, level: membershipLevel };
    await updateUser(id, fields);
  }
  res.redirect('/admin/usuarios');
});

app.post('/admin/usuarios/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteUser(req.body.id);
  res.redirect('/admin/usuarios');
});

// Admin: citas CRUD (ahora desde Turso)
app.get('/admin/citas', requireAuth, requireAdmin, async (req, res) => {
  const appointments = await getAllAppointments();
  res.render('admin/appointments', { appointments });
});

app.post('/admin/citas/crear', requireAuth, requireAdmin, async (req, res) => {
  const { customer, date, time, service } = req.body;
  if (customer && date && time && service) {
    await createAppointment({ id: uuidv4(), customer, name: customer, email: '', date, time, service, status: 'pendiente' });
  }
  res.redirect('/admin/citas');
});

app.post('/admin/citas/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, customer, date, time, service, status } = req.body;
  await updateAppointment(id, { customer, date, time, service, status });
  res.redirect('/admin/citas');
});

app.post('/admin/citas/estado', requireAuth, requireAdmin, async (req, res) => {
  const { id, status } = req.body;
  if (id && status) await updateAppointment(id, { status });
  res.redirect('/admin/citas');
});

app.post('/admin/citas/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteAppointment(req.body.id);
  res.redirect('/admin/citas');
});

// Admin: agenda de servicios (calendar view)
app.get('/admin/agenda-servicios', requireAuth, requireAdmin, async (req, res) => {
  const services = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];
  const appointments = await getAllAppointments();

  const now = new Date();
  const monthParam = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, month] = monthParam.split('-').map(Number);
  const selectedService = req.query.service || '';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  const calendarDays = [];

  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  for (let i = startingDayOfWeek - 1; i >= 0; i--) calendarDays.push({ date: prevMonthLastDay - i, isCurrentMonth: false, appointments: [] });
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarDays.push({ date: i, isCurrentMonth: true, appointments: appointments.filter(a => a.date === dateStr && (!selectedService || a.service === selectedService)), dateStr });
  }
  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) calendarDays.push({ date: i, isCurrentMonth: false, appointments: [] });

  const filteredAppointments = appointments.filter(a => {
    const d = new Date(a.date);
    return d.getFullYear() === year && (d.getMonth() + 1) === month && (!selectedService || a.service === selectedService);
  }).sort((a, b) => new Date(a.date) - new Date(b.date));

  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  res.render('admin/services-schedule', { services, calendarDays, filteredAppointments, currentMonth: monthParam, selectedService, monthYear: `${monthNames[month - 1]} ${year}`, appointments });
});

// Admin: cursos CRUD
app.get('/admin/cursos', requireAuth, requireAdmin, (req, res) => res.render('admin/courses', { list: courses }));

app.post('/admin/cursos/crear', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  if (slug && title) {
    courses.push({ slug, title, short: '', category: 'Técnico', level: 'Inicial', durationHours: 0, readingMinutes: 0, modality: 'Presencial', location: 'Bogotá D.C.', priceCOP: parseInt(priceCOP || '0', 10) || 0, tags: [], syllabus: [], outcomes: [], requirements: [], schedule: '', nextIntake: '' });
    saveJSON('courses.json', courses);
  }
  res.redirect('/admin/cursos');
});

app.post('/admin/cursos/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  const c = courses.find(x => x.slug === slug);
  if (c) { if (title) c.title = title; if (priceCOP !== undefined) c.priceCOP = parseInt(priceCOP || '0', 10) || 0; saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

app.post('/admin/cursos/eliminar', requireAuth, requireAdmin, (req, res) => {
  const idx = courses.findIndex(c => c.slug === req.body.slug);
  if (idx !== -1) { courses.splice(idx, 1); saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

// Admin: tienda CRUD
app.get('/admin/tienda', requireAuth, requireAdmin, (req, res) => {
  const search = (req.query.q || '').toString().trim().toLowerCase();
  const filterCat = (req.query.cat || '').toString();
  let prods = catalog.products || [];
  if (search) prods = prods.filter(p => p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search));
  if (filterCat) prods = prods.filter(p => p.category === filterCat);
  res.render('admin/shop', { categories: catalog.categories || [], products: prods, search, filterCat });
});

app.get('/admin/tienda/:id/editar', requireAuth, requireAdmin, (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.redirect('/admin/tienda');
  res.render('admin/shop-edit', { product, categories: catalog.categories || [] });
});

app.post('/admin/tienda/crear', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags } = req.body;
    if (!catalog.products) catalog.products = [];
    const prodId = id && id.trim() ? id.trim() : uuidv4();
    const gallery = (req.files || []).map(f => '/images/products/' + f.filename);
    const mainImage = gallery.length > 0 ? gallery[0] : '/images/download.png';
    if (name && category) {
      catalog.products.push({ id: prodId, name, price: parseInt(price || '0', 10) || 0, category, image: mainImage, gallery: gallery.length > 0 ? gallery : ['/images/download.png'], brand: (brand || '').trim(), sku: (sku || '').trim(), stock: parseInt(stock || '0', 10), discount: Math.min(100, Math.max(0, parseInt(discount || '0', 10))), tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

app.post('/admin/tienda/actualizar', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
    const p = (catalog.products || []).find(x => x.id === id);
    if (p) {
      if (name) p.name = name;
      if (price !== undefined) p.price = parseInt(price || '0', 10) || 0;
      if (category) p.category = category;
      if (description !== undefined) p.description = description;
      if (brand !== undefined) p.brand = (brand || '').trim();
      if (sku !== undefined) p.sku = (sku || '').trim();
      if (stock !== undefined) p.stock = parseInt(stock || '0', 10);
      if (discount !== undefined) p.discount = Math.min(100, Math.max(0, parseInt(discount || '0', 10)));
      if (tags !== undefined) p.tags = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
      let kept = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
      const newUploads = (req.files || []).map(f => '/images/products/' + f.filename);
      const gallery = [...kept, ...newUploads];
      if (gallery.length > 0) { p.gallery = gallery; p.image = gallery[0]; }
      p.updatedAt = new Date().toISOString();
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

app.post('/admin/tienda/eliminar', requireAuth, requireAdmin, (req, res) => {
  catalog.products = (catalog.products || []).filter(p => p.id !== req.body.id);
  writeCatalog(catalog);
  res.redirect('/admin/tienda');
});

app.post('/admin/tienda/upload-image', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: 'Error subiendo imágenes' });
    res.json({ ok: true, urls: (req.files || []).map(f => '/images/products/' + f.filename) });
  });
});

app.post('/admin/tienda/delete-image', requireAuth, requireAdmin, (req, res) => {
  const { productId, imageUrl } = req.body;
  const p = (catalog.products || []).find(x => x.id === productId);
  if (p && p.gallery) {
    p.gallery = p.gallery.filter(img => img !== imageUrl);
    p.image = p.gallery.length > 0 ? p.gallery[0] : '/images/download.png';
    if (!p.gallery.length) p.gallery = ['/images/download.png'];
    p.updatedAt = new Date().toISOString();
    writeCatalog(catalog);
  }
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
  res.redirect('/admin/tienda/' + productId + '/editar');
});

app.get('/admin/clases', requireAuth, requireAdmin, (req, res) => res.render('admin/classes', { classesData }));

// ── Newsletter ────────────────────────────────────────────────────────────

app.post('/newsletter', async (req, res) => {
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const isValid = /.+@.+\..+/.test(email);
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (!isValid) {
    if (wantsJSON) return res.status(400).json({ status: 'error', message: 'Correo inválido' });
    return res.redirect('/?flash=error');
  }
  if (RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY) {
    const ok = await verifyRecaptcha(req.body['g-recaptcha-response'], req.ip);
    if (!ok) {
      if (wantsJSON) return res.status(400).json({ status: 'captcha', message: 'Completa el reCAPTCHA' });
      return res.redirect('/?flash=captcha');
    }
  }
  const exist = await getNewsletterByEmail(email);
  if (!exist) await createNewsletter(email);
  if (wantsJSON) return res.json({ status: 'ok' });
  res.redirect('/?flash=ok');
});

// ── Presentaciones (admin) ────────────────────────────────────────────────

app.get('/clases/:course/:topic', requireAuth, requireAdmin, (req, res) => {
  const { course, topic } = req.params;
  const courseObj = classesData[course];
  if (!courseObj) return res.status(404).render('404');
  const topicObj = (courseObj.topics || {})[topic];
  if (!topicObj) return res.status(404).render('404');
  res.render('classes/presentation', { courseKey: course, courseTitle: courseObj.title, topicKey: topic, topicTitle: topicObj.title, slides: topicObj.slides || [] });
});

// ── Legales / Estáticas ───────────────────────────────────────────────────

app.get('/privacidad', (req, res) => res.render('privacy', {}));
app.get('/licencia',   (req, res) => res.render('license', {}));
app.get('/terminos',   (req, res) => res.render('terms', {}));
app.get('/mision',     (req, res) => res.render('mission'));
app.get('/vision',     (req, res) => res.render('vision'));
app.get('/faq',        (req, res) => res.render('faq'));

// ── Trabaja con nosotros ──────────────────────────────────────────────────

app.get('/trabaja', (req, res) => res.render('jobs', { status: req.query.status || null }));

app.post('/trabaja', async (req, res) => {
  const name       = (req.body.name       || '').toString().trim();
  const email      = (req.body.email      || '').toString().trim().toLowerCase();
  const phone      = (req.body.phone      || '').toString().trim();
  const experience = (req.body.experience || '').toString().trim();
  const skills     = (req.body.skills     || '').toString().trim();
  const message    = (req.body.message    || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) return res.redirect('/trabaja?status=error');
  await createJobApplication({ id: uuidv4(), name, email, phone, experience, skills, message });
  res.redirect('/trabaja?status=ok');
});

// ── Club ──────────────────────────────────────────────────────────────────

app.get('/club', async (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  const dir = path.join(__dirname, 'images', 'slideshow', 'club');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  let slidesClub = [];
  try {
    slidesClub = fs.readdirSync(dir).filter(f => allowed.has(path.extname(f).toLowerCase())).sort().map(f => `/images/slideshow/club/${encodeURIComponent(f)}`);
  } catch { }
  if (!slidesClub.length) slidesClub = ['/images/download.png'];
  let events = [];
  try { events = await getAllEvents(); } catch { }
  res.render('club/landing', { events, slidesClub });
});

// Rate limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
  skipSuccessfulRequests: true,
});

app.get('/club/login', (req, res) => res.render('club/login', { error: null }));

app.post('/club/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch {
    res.status(500).render('club/login', { error: 'Error del servidor' });
  }
});

app.get('/club/registro', (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  res.render('club/register', { error: null });
});

app.post('/club/registro', authLimiter, async (req, res) => {
  const { name, cedula, phone, birthdate, bloodType, city, nickname, clubNotifications, emergencyName, emergencyPhone, vehicleBrand, vehicleModel, vehicleYear, vehiclePlate, vehicleCC, vehicleColor, soatExpires, tecnoExpires, email, password, confirmPassword } = req.body;

  if (!name || !email || !password) return res.status(400).render('club/register', { error: 'Nombre, correo y contraseña son obligatorios' });
  if (password !== confirmPassword) return res.status(400).render('club/register', { error: 'Las contraseñas no coinciden' });

  try {
    if (await getUserByEmail(email)) return res.status(400).render('club/register', { error: 'El correo ya está en uso' });
    if (cedula && await getUserByCedula(cedula)) return res.status(400).render('club/register', { error: 'La cédula ya está en uso' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const vehicles = (vehicleBrand || vehiclePlate) ? [{ brand: vehicleBrand, model: vehicleModel, year: vehicleYear, plate: vehiclePlate, cc: vehicleCC, color: vehicleColor, soatExpires: soatExpires || null, tecnoExpires: tecnoExpires || null }] : [];

    const newUser = await createUser({
      name, email, password: hashedPassword, cedula, phone, birthdate, bloodType: bloodType || null, city,
      nickname, clubNotifications: clubNotifications === 'true',
      emergencyName, emergencyPhone,
      vehicles,
      membership: { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] },
    });

    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error(e);
    res.status(500).render('club/register', { error: 'Error del servidor' });
  }
});

app.get('/club/olvide', (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  res.render('club/forgot', { message: null, error: null });
});

app.post('/club/olvide', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('club/forgot', { error: 'Por favor, ingresa tu correo.', message: null });
  try {
    const user = await getUserByEmail(email);
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await updateUser(user.id, { resetToken, resetTokenExpiry: Date.now() + 3600000 });
      const resetLink = `${req.protocol}://${req.get('host')}/club/reset-password?token=${resetToken}`;
      if (process.env.RESEND_API_KEY) {
        await resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: user.email, subject: 'Recuperar contraseña - Gorillaz Motorbikes', html: `<p>Hola ${user.name || 'Motociclista'},</p><p>Para restablecer tu contraseña, haz clic en el siguiente enlace. Este enlace caducará en 1 hora.</p><p><a href="${resetLink}">[Restablecer contraseña]</a></p><p>Si no solicitaste este cambio, puedes ignorar este mensaje.</p>` });
      } else {
        console.log(`[DEV ONLY] Reset Link: ${resetLink}`);
      }
    }
  } catch (err) { console.error(err); }
  res.render('club/forgot', { message: 'Si el correo existe, te enviamos un enlace de restablecimiento.', error: null });
});

app.get('/club/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/club/olvide');
  const user = await getUserByResetToken(token);
  if (!user) return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  res.render('club/reset', { error: null, token });
});

app.post('/club/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body;
  if (password !== confirm) return res.render('club/reset', { error: 'Las contraseñas no coinciden.', token });
  const user = await getUserByResetToken(token);
  if (!user) return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  await updateUser(user.id, { password: await bcrypt.hash(password, 10), resetToken: null, resetTokenExpiry: null });
  res.redirect('/club/login');
});

app.post('/club/logout', (req, res) => {
  res.clearCookie('jwt');
  res.redirect('/');
});

app.get('/club/panel', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) return res.redirect('/club/login');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysBetween = (a, b) => Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  const reminders = (user.vehicles || []).map(v => ({
    plate: v.plate,
    soat:  v.soatExpires  ? daysBetween(new Date(v.soatExpires  + 'T00:00:00'), today) : null,
    tecno: v.tecnoExpires ? daysBetween(new Date(v.tecnoExpires + 'T00:00:00'), today) : null,
  }));
  res.render('club/dashboard', { user, reminders });
});

app.post('/club/visitas', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { date, service } = req.body;
  if (date && service) await updateUser(user.id, { visits: [{ date, service }, ...(user.visits || [])] });
  res.redirect('/club/panel');
});

app.post('/club/vehiculos', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  if (plate) {
    const plateUp = plate.trim().toUpperCase();
    const qrPayload = JSON.stringify({ t: 'vehicle', plate: plateUp, uid: user.id });
    const vehicles = [...(user.vehicles || []), { plate: plateUp, soatExpires: soatExpires || '', tecnoExpires: tecnoExpires || '', qr: qrPayload }];
    await updateUser(user.id, { vehicles });
  }
  res.redirect('/club/panel');
});

app.post('/club/vehiculos/eliminar', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const vehicles = (user.vehicles || []).filter(v => v.plate !== req.body.plate);
  await updateUser(user.id, { vehicles });
  res.redirect('/club/panel');
});

app.post('/club/vehiculos/actualizar', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  const vehicles = (user.vehicles || []).map(v => {
    if (v.plate !== (plate || '').toUpperCase()) return v;
    return { ...v, soatExpires: soatExpires ?? v.soatExpires, tecnoExpires: tecnoExpires ?? v.tecnoExpires, qr: v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id }) };
  });
  await updateUser(user.id, { vehicles });
  res.redirect('/club/panel');
});

app.get('/club/vehiculos/:plate/qr.png', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const plate = (req.params.plate || '').toUpperCase();
  const v = (user.vehicles || []).find(x => x.plate === plate);
  if (!v) return res.status(404).send('No encontrado');
  try {
    const payload = v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id });
    const png = await QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', width: 384, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch { res.status(500).send('Error generando QR'); }
});

// ── 404 ───────────────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).render('404'));

module.exports = app;

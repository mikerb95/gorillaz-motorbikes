const express = require('express');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('./models/User');
const Appointment = require('./models/Appointment');
const Event = require('./models/Event');
const Newsletter = require('./models/Newsletter');
const Enrollment = require('./models/Enrollment');
const JobApplication = require('./models/JobApplication');
const Course = require('./models/Course');
const Settings = require('./models/Settings');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const resendClient = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_to_prevent_crash_123');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
const https = require('https');
const catalog = require('./data/catalog');
const courses = require('./data/courses.json');
const classesData = require('./data/classes.json');
const QRCode = require('qrcode');

const app = express();

// Multer config for product image uploads
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'images', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|avif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
}).array('images', 5);

const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  } else {
    console.warn('[WARN] JWT_SECRET not set — using insecure dev-only fallback');
  }
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-fallback';

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/gorillaz')
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => console.error('❌ MongoDB connection error:', err));


// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || JWT_SECRET));

// CSRF token generation middleware
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

// JWT Verification Middleware
app.use((req, res, next) => {
  const token = req.cookies.jwt;
  req.session = req.session || {}; // Fallback empty object
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.id;
    } catch (err) {
      req.userId = null;
    }
  }

  // Fake cart object temporarily until DB cart is added:
  let cartCookie = { items: {}, count: 0, subtotal: 0 };
  if (req.cookies.cart) {
    try {
      cartCookie = JSON.parse(req.cookies.cart);
    } catch (_) {
      res.clearCookie('cart');
    }
  }
  req.session.cart = cartCookie;

  next();
});

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/favicons', express.static(path.join(__dirname, 'favicons')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Locals for templates
app.use(async (req, res, next) => {
  if (req.userId) {
    try {
      res.locals.user = await User.findById(req.userId).lean();
    } catch (e) { res.locals.user = null; }
  } else {
    res.locals.user = null;
  }
  const c = req.session.cart || { items: {}, count: 0, subtotal: 0 };
  // compute totals defensively without relying on other helpers
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(c.items || {})) {
    const prod = (catalog.products || []).find(p => p.id === id);
    if (prod) { count += qty; subtotal += prod.price * qty; }
  }
  res.locals.cart = { items: c.items || {}, count, subtotal };
  // Build a lightweight cart items array for header hover
  try {
    res.locals.cartItems = Object.entries(c.items || {}).map(([id, qty]) => {
      const p = (catalog.products || []).find(pp => pp.id === id);
      if (!p) return null;
      return { id, name: p.name, qty, total: (p.price || 0) * qty };
    }).filter(Boolean);
  } catch { res.locals.cartItems = []; }
  // Upcoming events badge and first anchor for sub-bar
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let events = [];
    if (mongoose.connection.readyState === 1) {
      events = await Event.find().sort({ date: 1 }).lean();
    }
    let count = 0; let firstIdx = -1;
    (events || []).forEach((ev, i) => {
      if (!ev || !ev.date) return;
      const t = Date.parse(ev.date);
      if (!Number.isFinite(t)) return;
      const d = new Date(t); d.setHours(0, 0, 0, 0);
      if (d >= today) {
        count++;
        if (firstIdx === -1) firstIdx = i;
      }
    });
    res.locals.eventsUpcoming = count;
    res.locals.eventsFirstAnchor = firstIdx >= 0 ? ('#ev-' + firstIdx) : '';
  } catch {
    res.locals.eventsUpcoming = 0;
    res.locals.eventsFirstAnchor = '';
  }
  next();
});

// CSRF validation middleware
const validateCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const token = req.body._csrf || req.headers['x-csrf-token'];
  const cookieToken = req.cookies._csrf;
  if (!token || token !== cookieToken) {
    return res.status(403).render('403', { message: 'Token CSRF inválido. Actualiza la página e inténtalo de nuevo.' });
  }
  next();
};

app.use(validateCsrf);

// Helpers
const requireAuth = (req, res, next) => {
  if (!req.userId) return res.redirect('/club/login');
  next();
};
const requireAdmin = (req, res, next) => {
  const u = res.locals.user;
  if (!u || u.role !== 'admin') return res.status(403).render('404');
  next();
};

// Admin data stores
let availability = { blockedDates: [] };
try { availability = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'availability.json'), 'utf8')); } catch { }

const saveJSON = (file, data) => {
  fs.writeFileSync(path.join(__dirname, 'data', file), JSON.stringify(data, null, 2), 'utf8');
};
const writeCatalog = (obj) => {
  const file = path.join(__dirname, 'data', 'catalog.js');
  const content = 'module.exports = ' + JSON.stringify(obj, null, 2) + ' ;\n';
  fs.writeFileSync(file, content, 'utf8');
};

// Routes
app.get('/', (req, res) => {
  // Build slideshow images list; prefer WEBP variants under images/slideshow/WEBP
  const slidesDirWebp = path.join(__dirname, 'images', 'slideshow', 'WEBP');
  const slidesDir = path.join(__dirname, 'images', 'slideshow');
  let slides = [];
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  const readSlides = (dir, urlPrefix) => {
    try {
      const files = fs.readdirSync(dir);
      return files
        .filter(f => allowed.has(path.extname(f).toLowerCase()))
        .sort()
        .map(f => `${urlPrefix}/${encodeURIComponent(f)}`);
    } catch {
      return [];
    }
  };
  // Try WEBP folder first
  slides = readSlides(slidesDirWebp, '/images/slideshow/WEBP');
  // Fallback to original folder if empty
  if (!slides.length) {
    slides = readSlides(slidesDir, '/images/slideshow');
  }
  res.render('home', {

    slides,
    newsletterStatus: req.session.newsletterStatus || null,
    recaptchaSiteKey: RECAPTCHA_SITE_KEY
  });
  req.session.newsletterStatus = null;
});

// Helper: compute demand map { 'YYYY-MM-DD': 'low'|'medium'|'high' }
async function computeDemandMap() {
  const demand = {};
  const appointments = await Appointment.find({}, 'date').lean();
  appointments.forEach(a => {
    if (!a.date) return;
    const d = a.date.slice(0, 10);
    demand[d] = (demand[d] || 0) + 1;
  });
  // Also read admin-set occupation levels from availability
  if (availability && availability.occupationLevels) {
    Object.entries(availability.occupationLevels).forEach(([d, lvl]) => {
      if (lvl === 'high') demand[d] = Math.max(demand[d] || 0, 8);
      else if (lvl === 'medium') demand[d] = Math.max(demand[d] || 0, 4);
    });
  }
  const result = {};
  Object.entries(demand).forEach(([d, count]) => {
    if (count >= 6) result[d] = 'high';
    else if (count >= 3) result[d] = 'medium';
    else result[d] = 'low';
  });
  return result;
}

// Servicios: agendar (definir antes de /servicios para evitar conflictos de orden)
app.get('/servicios/agendar', async (req, res) => {
  const services = [
    'Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'
  ];
  res.render('services_schedule', { services, bookingMessage: null, demandMap: await computeDemandMap() });
});

app.post('/servicios/agendar', async (req, res) => {
  const { name, email, phone, service, date } = req.body;
  const services = [
    'Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'
  ];
  const demandMap = await computeDemandMap();
  if (!name || !service || !date || !email) {
    return res.render('services_schedule', { services, bookingMessage: 'Por favor completa todos los campos.', demandMap });
  }
  const formattedDate = new Date(date).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await Appointment.create({ id: uuidv4(), name, email, phone, service, date, status: 'pendiente' });
  // Send confirmation emails via Resend
  try {
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_TU_API_KEY_AQUI') {
      const clientMailHtml = `<p>Hola <strong>${name}</strong>,</p><p>Hemos recibido tu solicitud de cita para <strong>${service}</strong> el <strong>${formattedDate}</strong>.</p><p>Nuestro equipo te contactará al número <strong>${phone}</strong> para confirmar la cita.</p><p>Gracias por confiar en Gorillaz Motorbikes.</p>`;
      const bookingMailHtml = `<p><strong>Nueva solicitud de cita</strong></p><ul><li><strong>Cliente:</strong> ${name}</li><li><strong>Email:</strong> ${email}</li><li><strong>Teléfono:</strong> ${phone}</li><li><strong>Servicio:</strong> ${service}</li><li><strong>Fecha solicitada:</strong> ${formattedDate}</li></ul>`;
      await Promise.allSettled([
        resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: email, subject: `Confirmación de cita — ${service}`, html: clientMailHtml }),
        resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com', subject: `Nueva cita: ${service} — ${name}`, html: bookingMailHtml })
      ]);
    }
  } catch (e) {
    console.error('Resend error:', e.message);
  }
  const bookingMessage = `Gracias ${name}. Confirmación enviada a ${email}. Te contactaremos al ${phone}.`;
  res.render('services_schedule', { services, bookingMessage, demandMap: computeDemandMap() });
});

// Servicios: Nuevas páginas "Próximamente"
app.get('/servicios/lavado-motos', (req, res) => res.render('services/lavado-motos'));
app.get('/servicios/lavado-cascos', (req, res) => res.render('services/lavado-cascos'));
app.get('/servicios/detailing-motos', (req, res) => res.render('services/detailing-motos'));

// Servicios: página informativa
app.get('/servicios', (req, res) => {
  const services = [
    { slug: 'lavado-motos', title: 'Lavado de motos', desc: 'Limpieza profunda con productos especializados para cuidar la pintura y componentes de tu máquina.', img: '/images/services/lavado-motos.png' },
    { slug: 'lavado-cascos', title: 'Lavado de cascos', desc: 'Desinfección y limpieza interna y externa para mantener tu seguridad y confort al rodar.', img: '/images/services/lavado-cascos.webp' },
    { slug: 'detailing-motos', title: 'Detailing de motos', desc: 'Restauración estética detallada, polichado y protección cerámica para un brillo único.', img: '/images/services/detailing-motos.webp' },
    { slug: 'mecanica', title: 'Mecánica', desc: 'Diagnóstico, mantenimiento preventivo y correctivo. Trabajamos con control de calidad para que tu moto siempre rinda al máximo.', img: '/images/services/mecanica.webp' },
    { slug: 'pintura', title: 'Pintura', desc: 'Acabados profesionales, retoques y protección. Cuidamos el detalle y la durabilidad.', img: '/images/services/pintura.webp' },
    { slug: 'alistamiento-tecnomecanica', title: 'Alistamiento tecnomecánica', desc: 'Revisión integral y ajustes previos a la inspección para evitar sorpresas y rechazos.', img: '/images/services/alistamiento.webp' },
    { slug: 'electricidad', title: 'Electricidad', desc: 'Sistema de carga, arranque e iluminación. Diagnóstico electrónico confiable.', img: '/images/services/electricidad.webp' },
    { slug: 'torno', title: 'Torno', desc: 'Fabricación y ajuste de componentes a medida según especificación.', img: '/images/services/torno.webp' },
    { slug: 'prensa', title: 'Prensa', desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.', img: '/images/services/prensa.webp' },
    { slug: 'mecanica-rapida', title: 'Mecánica rápida', desc: 'Servicios ágiles como cambios de aceite y ajustes menores con cita.', img: '/images/services/mecanica-rapida.webp' },
    { slug: 'escaneo-de-motos', title: 'Escaneo de motos', desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.', img: '/images/services/scaneo.webp' },
  ];
  res.render('services', { services });
});

// Servicios: agendar cita — alias (ya definido arriba, sólo redirige por si queda algún link antiguo)

// Fallback redirects for legacy/variant URLs
app.get(['/agendar-servicio', '/servicios/agenda', '/agenda-servicio', '/agenda'], (req, res) => {
  res.redirect('/servicios/agendar');
});

app.get('/tienda', (req, res) => {
  const allCats = catalog.categories;
  const allProds = catalog.products;
  const priceVals = (allProds || []).map(p => p.price).filter(n => Number.isFinite(n));
  const priceStats = {
    min: priceVals.length ? Math.min(...priceVals) : 0,
    max: priceVals.length ? Math.max(...priceVals) : 0
  };
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const selectedCat = (req.query.cat || '').toString();
  const min = Number.isFinite(parseInt(req.query.min, 10)) ? parseInt(req.query.min, 10) : null;
  const max = Number.isFinite(parseInt(req.query.max, 10)) ? parseInt(req.query.max, 10) : null;
  const sort = (req.query.sort || '').toString();

  // Base filter: text and price
  let base = allProds.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))) return false;
    if (min !== null && p.price < min) return false;
    if (max !== null && p.price > max) return false;
    return true;
  });

  // Category counts based on base filters
  const categories = allCats.map(c => ({
    ...c,
    count: base.filter(p => p.category === c.slug).length
  }));

  // Apply category filter
  let products = selectedCat ? base.filter(p => p.category === selectedCat) : base;

  // Sorting
  if (sort === 'price-asc') products = products.slice().sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') products = products.slice().sort((a, b) => b.price - a.price);

  // Collect unique brands for filter
  const brands = [...new Set((allProds || []).map(p => p.brand).filter(Boolean))].sort();
  const selectedBrand = (req.query.brand || '').toString();
  if (selectedBrand) {
    products = products.filter(p => p.brand === selectedBrand);
  }

  // Build base query string (without category) to reuse in links
  const qp = new URLSearchParams();
  if (q) qp.set('q', q);
  if (min !== null) qp.set('min', String(min));
  if (max !== null) qp.set('max', String(max));
  if (sort) qp.set('sort', sort);
  const baseQuery = qp.toString();

  // Pagination
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = 12;
  const totalPages = Math.ceil(products.length / perPage);
  const paginated = products.slice((page - 1) * perPage, page * perPage);

  res.render('shop', {
    categories,
    products: paginated,
    allProductsCount: products.length,
    selectedCat,
    q,
    min: min ?? '',
    max: max ?? '',
    sort,
    baseQuery,
    priceStats,
    page,
    totalPages,
    brands,
    selectedBrand
  });
});

// Product detail page
app.get('/tienda/:id', (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.status(404).render('404');
  const cat = (catalog.categories || []).find(c => c.slug === product.category);
  const related = (catalog.products || [])
    .filter(p => p.category === product.category && p.id !== product.id)
    .slice(0, 4);
  res.render('shop-product', { product, category: cat, related });
});

// Cart helpers
const getCart = (req) => {
  if (!req.session.cart) req.session.cart = { items: {}, count: 0, subtotal: 0 };
  return req.session.cart;
};
const recalc = (cart) => {
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(cart.items)) {
    const prod = catalog.products.find(p => p.id === id);
    if (prod) { count += qty; subtotal += prod.price * qty; }
  }
  cart.count = count; cart.subtotal = subtotal; return cart;
};

// Add to cart
app.post('/cart/add', (req, res) => {
  const { id, qty } = req.body;
  const product = catalog.products.find(p => p.id === id);
  if (!product) return res.status(400).send('Producto no encontrado');
  const cart = getCart(req);
  const q = Math.max(1, parseInt(qty || '1', 10));
  // Enforce stock limit
  const maxStock = typeof product.stock === 'number' ? product.stock : Infinity;
  const current = cart.items[id] || 0;
  cart.items[id] = Math.min(current + q, maxStock);
  if (maxStock === 0) {
    // Cannot add out-of-stock item
    const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
    if (wantsJSON) return res.status(400).json({ ok: false, message: 'Producto agotado' });
    return res.redirect('/carrito');
  }
  recalc(cart);
  // Save cart to cookie
  res.cookie('cart', JSON.stringify(cart), { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (wantsJSON) {
    return res.json({ ok: true, cartCount: cart.count, message: `${product.name} añadido al carrito` });
  }
  res.redirect('/carrito');
});

// Update cart
app.post('/cart/update', (req, res) => {
  const { id, qty } = req.body;
  const cart = getCart(req);
  const q = Math.max(0, parseInt(qty || '0', 10));
  if (q === 0) delete cart.items[id]; else cart.items[id] = q;
  recalc(cart);
  res.cookie('cart', JSON.stringify(cart), { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
  res.redirect('/carrito');
});

// Clear cart
app.post('/cart/clear', (req, res) => {
  req.session.cart = { items: {}, count: 0, subtotal: 0 };
  res.cookie('cart', JSON.stringify(req.session.cart), { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
  res.redirect('/carrito');
});

// Cart page
app.get('/carrito', (req, res) => {
  const cart = recalc(getCart(req));
  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    return { ...p, qty, total: p.price * qty };
  });
  res.render('cart', { items, cart });
});

// Checkout (mock)
app.get('/checkout', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  res.render('checkout', { cart });
});

// Mock payment gateway
app.post('/pagar', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  // Simulate success
  const orderId = uuidv4();
  const total = cart.subtotal;
  req.session.cart = { items: {}, count: 0, subtotal: 0 };
  res.cookie('cart', JSON.stringify(req.session.cart), { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
  res.render('payment/success', { orderId, total });
});

app.get('/cursos', (req, res) => {
  res.render('courses', { list: courses });
});

app.get('/cursos/:slug', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.render('course', { course, enrollStatus: req.session.enrollStatus || null });
  req.session.enrollStatus = null;
});

// Inscripción a curso: página directa (redirige al ancla del detalle)
app.get('/cursos/:slug/inscripcion', (req, res) => {
  const slug = req.params.slug;
  const course = courses.find(c => c.slug === slug);
  if (!course) return res.status(404).render('404');
  res.redirect(`/cursos/${encodeURIComponent(slug)}#inscripcion`);
});

// Inscripción a curso: envío de formulario
app.post('/cursos/:slug/inscripcion', async (req, res) => {
  const slug = req.params.slug;
  const course = courses.find(c => c.slug === slug);
  if (!course) return res.status(404).render('404');
  const name = (req.body.name || '').toString().trim();
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const phone = (req.body.phone || '').toString().trim();
  const notes = (req.body.notes || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) {
    req.session.enrollStatus = 'error';
    return res.redirect(`/cursos/${encodeURIComponent(slug)}#inscripcion`);
  }
  await Enrollment.create({
    id: uuidv4(), slug, courseTitle: course.title,
    name, email, phone, notes,
    createdAt: new Date()
  });
  req.session.enrollStatus = 'ok';
  res.redirect(`/cursos/${encodeURIComponent(slug)}#inscripcion`);
});

// Public events page
app.get('/eventos', async (req, res) => {
  const events = await Event.find().sort({ date: 1 }).lean();
  res.render('events', { events });
});

// Admin dashboard
app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const usersCount = await User.countDocuments();
  const eventsCount = await Event.countDocuments();
  const citasCount = await Appointment.countDocuments();

  res.render('admin/index', {
    stats: {
      users: usersCount,
      events: eventsCount,
      citas: citasCount,
      cursos: courses.length,
      productos: (catalog.products || []).length
    }
  });
});

// Admin: availability calendar
app.get('/admin/calendario', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/calendar', { availability });
});
app.post('/admin/calendario/bloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  if (date && !availability.blockedDates.includes(date)) {
    availability.blockedDates.push(date);
    saveJSON('availability.json', availability);
  }
  res.redirect('/admin/calendario');
});
app.post('/admin/calendario/desbloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  availability.blockedDates = availability.blockedDates.filter(d => d !== date);
  saveJSON('availability.json', availability);
  res.redirect('/admin/calendario');
});

// Admin: events CRUD
app.get('/admin/eventos', requireAuth, requireAdmin, async (req, res) => {
  const events = await Event.find().sort({ createdAt: -1 }).lean();
  res.render('admin/events', { events });
});
app.post('/admin/eventos/crear', requireAuth, requireAdmin, async (req, res) => {
  const { title, date, location, description } = req.body;
  if (title && date) {
    await Event.create({ id: uuidv4(), title, date, location, description });
  }
  res.redirect('/admin/eventos');
});
app.post('/admin/eventos/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, title, date, location, description } = req.body;
  const ev = await Event.findOne({ id });
  if (ev) {
    if (title) ev.title = title;
    if (date) ev.date = date;
    if (typeof location !== 'undefined') ev.location = location;
    if (typeof description !== 'undefined') ev.description = description;
    await ev.save();
  }
  res.redirect('/admin/eventos');
});
app.post('/admin/eventos/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  await Event.deleteOne({ id });
  res.redirect('/admin/eventos');
});

// Admin: users (modify or delete)
app.get('/admin/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const usersList = await User.find().lean();
  res.render('admin/users', { users: usersList });
});
app.post('/admin/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, membershipLevel } = req.body;
  const u = await User.findById(id);
  if (u) {
    if (name) u.name = name;
    if (membershipLevel) {
      if (!u.membership) u.membership = {};
      u.membership.level = membershipLevel;
    }
    await u.save();
  }
  res.redirect('/admin/usuarios');
});
app.post('/admin/usuarios/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  await User.findByIdAndDelete(id);
  res.redirect('/admin/usuarios');
});

// Admin: citas CRUD
app.get('/admin/citas', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/appointments', { appointments });
});
app.post('/admin/citas/crear', requireAuth, requireAdmin, (req, res) => {
  const { customer, date, time, service } = req.body;
  if (customer && date && time && service) {
    appointments.unshift({ id: uuidv4(), customer, date, time, service, status: 'pendiente', createdAt: new Date().toISOString() });
  }
  res.redirect('/admin/citas');
});
app.post('/admin/citas/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, customer, date, time, service, status } = req.body;
  const a = appointments.find(x => x.id === id);
  if (a) {
    if (customer) a.customer = customer;
    if (date) a.date = date;
    if (time) a.time = time;
    if (service) a.service = service;
    if (status) a.status = status;
  }
  res.redirect('/admin/citas');
});
app.post('/admin/citas/estado', requireAuth, requireAdmin, (req, res) => {
  const { id, status } = req.body;
  const a = appointments.find(x => x.id === id);
  if (a) a.status = status || a.status;
  res.redirect('/admin/citas');
});
app.post('/admin/citas/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  appointments = appointments.filter(x => x.id !== id);
  res.redirect('/admin/citas');
});

// Admin: agenda de servicios (calendar view)
app.get('/admin/agenda-servicios', requireAuth, requireAdmin, (req, res) => {
  const services = [
    'Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'
  ];

  // Get current month or from query
  const now = new Date();
  const monthParam = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, month] = monthParam.split('-').map(Number);

  const selectedService = req.query.service || '';

  // Build calendar
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const calendarDays = [];

  // Add previous month's days
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    calendarDays.push({
      date: prevMonthLastDay - i,
      isCurrentMonth: false,
      appointments: []
    });
  }

  // Add current month's days
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    const dayAppointments = appointments.filter(apt => apt.date === dateStr && (!selectedService || apt.service === selectedService));
    calendarDays.push({
      date: i,
      isCurrentMonth: true,
      appointments: dayAppointments,
      dateStr: dateStr
    });
  }

  // Add next month's days to complete the grid
  const remainingDays = 42 - calendarDays.length;
  for (let i = 1; i <= remainingDays; i++) {
    calendarDays.push({
      date: i,
      isCurrentMonth: false,
      appointments: []
    });
  }

  // Filter appointments for the list below
  const filteredAppointments = appointments.filter(apt => {
    const aptDate = new Date(apt.date);
    const aptMonth = aptDate.getMonth() + 1;
    const aptYear = aptDate.getFullYear();
    return aptYear === year && aptMonth === month && (!selectedService || apt.service === selectedService);
  }).sort((a, b) => new Date(a.date) - new Date(b.date));

  // Format month year
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthYear = `${monthNames[month - 1]} ${year}`;

  res.render('admin/services-schedule', {
    services,
    calendarDays,
    filteredAppointments,
    currentMonth: monthParam,
    selectedService,
    monthYear,
    appointments
  });
});

// Admin: cursos CRUD
app.get('/admin/cursos', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/courses', { list: courses });
});
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
  if (c) {
    if (title) c.title = title;
    if (typeof priceCOP !== 'undefined') c.priceCOP = parseInt(priceCOP || '0', 10) || 0;
    saveJSON('courses.json', courses);
  }
  res.redirect('/admin/cursos');
});
app.post('/admin/cursos/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { slug } = req.body;
  const idx = courses.findIndex(c => c.slug === slug);
  if (idx !== -1) { courses.splice(idx, 1); saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

// Newsletter subscribe (simple)
const verifyRecaptcha = (token, ip) => new Promise((resolve) => {
  if (!RECAPTCHA_SECRET_KEY) return resolve(true); // If not configured, skip verification
  const data = new URLSearchParams({
    secret: RECAPTCHA_SECRET_KEY,
    response: token || '',
    remoteip: ip || ''
  }).toString();
  const reqOpts = {
    hostname: 'www.google.com',
    path: '/recaptcha/api/siteverify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  const r = https.request(reqOpts, (resp) => {
    let body = '';
    resp.on('data', (d) => body += d);
    resp.on('end', () => {
      try { const json = JSON.parse(body); resolve(!!json.success); }
      catch { resolve(false); }
    });
  });
  r.on('error', () => resolve(false));
  r.write(data); r.end();
});

app.post('/newsletter', async (req, res) => {
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const isValid = /.+@.+\..+/.test(email);
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (!isValid) {
    if (wantsJSON) return res.status(400).json({ status: 'error', message: 'Correo inválido' });
    req.session.newsletterStatus = 'error';
    return res.redirect('/');
  }
  // Verify reCAPTCHA if configured
  if (RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY) {
    const token = req.body['g-recaptcha-response'];
    const ok = await verifyRecaptcha(token, req.ip);
    if (!ok) {
      if (wantsJSON) return res.status(400).json({ status: 'captcha', message: 'Completa el reCAPTCHA' });
      req.session.newsletterStatus = 'captcha';
      return res.redirect('/');
    }
  }
  const exist = await Newsletter.findOne({ email });
  if (!exist) {
    await Newsletter.create({ email });
  }
  if (wantsJSON) return res.json({ status: 'ok' });
  req.session.newsletterStatus = 'ok';
  res.redirect('/');
});

// Admin: tienda (productos) CRUD
app.get('/admin/tienda', requireAuth, requireAdmin, (req, res) => {
  const search = (req.query.q || '').toString().trim().toLowerCase();
  const filterCat = (req.query.cat || '').toString();
  let prods = catalog.products || [];
  if (search) prods = prods.filter(p => p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search));
  if (filterCat) prods = prods.filter(p => p.category === filterCat);
  res.render('admin/shop', { categories: catalog.categories || [], products: prods, search, filterCat });
});

// Admin: edit single product page
app.get('/admin/tienda/:id/editar', requireAuth, requireAdmin, (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.redirect('/admin/tienda');
  res.render('admin/shop-edit', { product, categories: catalog.categories || [] });
});

// Admin: create product
app.post('/admin/tienda/crear', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags } = req.body;
    if (!catalog.products) catalog.products = [];
    const prodId = id && id.trim() ? id.trim() : uuidv4();
    const gallery = (req.files || []).map(f => '/images/products/' + f.filename);
    // Use first gallery image or fallback
    const mainImage = gallery.length > 0 ? gallery[0] : '/images/download.png';
    if (name && category) {
      catalog.products.push({
        id: prodId,
        name,
        price: parseInt(price || '0', 10) || 0,
        category,
        image: mainImage,
        gallery: gallery.length > 0 ? gallery : ['/images/download.png'],
        brand: (brand || '').trim(),
        sku: (sku || '').trim(),
        stock: parseInt(stock || '0', 10),
        discount: Math.min(100, Math.max(0, parseInt(discount || '0', 10))),
        tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
        description: description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

// Admin: update product
app.post('/admin/tienda/actualizar', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
    const p = (catalog.products || []).find(x => x.id === id);
    if (p) {
      if (name) p.name = name;
      if (typeof price !== 'undefined') p.price = parseInt(price || '0', 10) || 0;
      if (category) p.category = category;
      if (typeof description !== 'undefined') p.description = description;
      if (typeof brand !== 'undefined') p.brand = (brand || '').trim();
      if (typeof sku !== 'undefined') p.sku = (sku || '').trim();
      if (typeof stock !== 'undefined') p.stock = parseInt(stock || '0', 10);
      if (typeof discount !== 'undefined') p.discount = Math.min(100, Math.max(0, parseInt(discount || '0', 10)));
      if (typeof tags !== 'undefined') p.tags = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
      // Rebuild gallery: keep existing + add new uploads
      let kept = [];
      if (existingImages) {
        kept = Array.isArray(existingImages) ? existingImages : [existingImages];
      }
      const newUploads = (req.files || []).map(f => '/images/products/' + f.filename);
      const gallery = [...kept, ...newUploads];
      if (gallery.length > 0) {
        p.gallery = gallery;
        p.image = gallery[0];
      }
      p.updatedAt = new Date().toISOString();
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

// Admin: delete product
app.post('/admin/tienda/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  catalog.products = (catalog.products || []).filter(p => p.id !== id);
  writeCatalog(catalog);
  res.redirect('/admin/tienda');
});

// Admin: upload images endpoint (AJAX)
app.post('/admin/tienda/upload-image', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: 'Error subiendo imágenes' });
    const urls = (req.files || []).map(f => '/images/products/' + f.filename);
    res.json({ ok: true, urls });
  });
});

// Admin: delete a product image from gallery
app.post('/admin/tienda/delete-image', requireAuth, requireAdmin, (req, res) => {
  const { productId, imageUrl } = req.body;
  const p = (catalog.products || []).find(x => x.id === productId);
  if (p && p.gallery) {
    p.gallery = p.gallery.filter(img => img !== imageUrl);
    if (p.gallery.length > 0) {
      p.image = p.gallery[0];
    } else {
      p.image = '/images/download.png';
      p.gallery = ['/images/download.png'];
    }
    p.updatedAt = new Date().toISOString();
    writeCatalog(catalog);
  }
  const wantsJSON = (req.headers.accept || '').includes('application/json');
  if (wantsJSON) return res.json({ ok: true });
  res.redirect('/admin/tienda/' + productId + '/editar');
});

// Admin: selector de clases/presentaciones
app.get('/admin/clases', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/classes', { classesData });
});

// Presentación en vivo (admin)
app.get('/clases/:course/:topic', requireAuth, requireAdmin, (req, res) => {
  const { course, topic } = req.params;
  const courseObj = classesData[course];
  if (!courseObj) return res.status(404).render('404');
  const topicObj = (courseObj.topics || {})[topic];
  if (!topicObj) return res.status(404).render('404');
  res.render('classes/presentation', {
    courseKey: course,
    courseTitle: courseObj.title,
    topicKey: topic,
    topicTitle: topicObj.title,
    slides: topicObj.slides || []
  });
});

// Legales
app.get('/privacidad', (req, res) => {
  res.render('privacy', {});
});
app.get('/licencia', (req, res) => {
  res.render('license', {});
});
app.get('/terminos', (req, res) => {
  res.render('terms', {});
});

// Trabaja con nosotros
app.get('/trabaja', (req, res) => {
  res.render('jobs', { status: req.session.jobStatus || null });
  req.session.jobStatus = null;
});
app.post('/trabaja', async (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const phone = (req.body.phone || '').toString().trim();
  const experience = (req.body.experience || '').toString().trim();
  const skills = (req.body.skills || '').toString().trim();
  const message = (req.body.message || '').toString().trim();
  if (!name || !/.+@.+\..+/.test(email)) {
    req.session.jobStatus = 'error';
    return res.redirect('/trabaja');
  }
  await JobApplication.create({ id: uuidv4(), name, email, phone, experience, skills, message, createdAt: new Date() });
  req.session.jobStatus = 'ok';
  res.redirect('/trabaja');
});

// Misión y Visión
app.get('/mision', (req, res) => {
  res.render('mission');
});
app.get('/vision', (req, res) => {
  res.render('vision');
});

// Preguntas frecuentes
app.get('/faq', (req, res) => {
  res.render('faq');
});

// Club
app.get('/club', async (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  // Build club slideshow from /images/slideshow/club
  const dir = path.join(__dirname, 'images', 'slideshow', 'club');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  let slidesClub = [];
  try {
    const files = fs.readdirSync(dir);
    slidesClub = files
      .filter(f => allowed.has(path.extname(f).toLowerCase()))
      .sort()
      .map(f => `/images/slideshow/club/${encodeURIComponent(f)}`);
  } catch { }
  if (!slidesClub.length) {
    // Fallback to existing banner if no club slides found
    slidesClub = ['/images/download.png'];
  }
  let events = [];
  if (mongoose.connection.readyState === 1) {
    try {
      events = await Event.find().sort({ date: 1 }).lean();
    } catch {
      events = [];
    }
  }
  res.render('club/landing', { events, slidesClub });
});

app.get('/club/login', (req, res) => {
  res.render('club/login', { error: null });
});

app.post('/club/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    res.status(500).render('club/login', { error: 'Error del servidor' });
  }
});

// Registro (mock)
app.get('/club/registro', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.render('club/register');
});
app.post('/club/registro', async (req, res) => {
  const {
    name, cedula, phone, birthdate, bloodType, city,
    nickname, clubNotifications,
    emergencyName, emergencyPhone,
    vehicleBrand, vehicleModel, vehicleYear, vehiclePlate, vehicleCC, vehicleColor,
    soatExpires, tecnoExpires,
    email, password, confirmPassword
  } = req.body;

  if (!name || !email || !password)
    return res.status(400).render('club/register', { error: 'Nombre, correo y contraseña son obligatorios' });
  if (password !== confirmPassword)
    return res.status(400).render('club/register', { error: 'Las contraseñas no coinciden' });

  try {
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).render('club/register', { error: 'El correo ya está en uso' });

    // Check cedula to prevent duplicates if provided
    if (cedula) {
      const cedulaExists = await User.findOne({ cedula });
      if (cedulaExists) return res.status(400).render('club/register', { error: 'La cédula ya está en uso' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const vehicle = (vehicleBrand || vehiclePlate) ? [{
      brand: vehicleBrand, model: vehicleModel, year: vehicleYear,
      plate: vehiclePlate, cc: vehicleCC, color: vehicleColor,
      soatExpires: soatExpires || null, tecnoExpires: tecnoExpires || null
    }] : [];

    const newUser = new User({
      name, email, password: hashedPassword,
      cedula, phone, birthdate, bloodType, city,
      nickname, clubNotifications: clubNotifications === 'true',
      emergencyName, emergencyPhone,
      vehicles: vehicle,
      membership: {
        level: 'Básica',
        since: new Date().toISOString().slice(0, 10),
        expires: null,
        benefits: ['Descuentos en taller', 'Acceso al club']
      },
    });
    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error(e);
    res.status(500).render('club/register', { error: 'Error del servidor' });
  }
});

// Olvidé mi contraseña (mock)
app.get('/club/olvide', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.render('club/forgot', { message: null, error: null });
});

app.post('/club/olvide', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('club/forgot', { error: 'Por favor, ingresa tu correo.', message: null });

  try {
    const user = await User.findOne({ email });
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      user.resetToken = resetToken;
      user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
      await user.save();

      const resetLink = `${req.protocol}://${req.get('host')}/club/reset-password?token=${resetToken}`;

      if (process.env.RESEND_API_KEY) {
        await resendClient.emails.send({
          from: 'booking@gorillazmotorbikes.com',
          to: user.email,
          subject: 'Recuperar contraseña - Gorillaz Motorbikes',
          html: `<p>Hola ${user.name || 'Motociclista'},</p><p>Para restablecer tu contraseña, haz clic en el siguiente enlace. Este enlace caducará en 1 hora.</p><p><a href="${resetLink}">[Restablecer contraseña]</a></p><p>Si no solicitaste este cambio, puedes ignorar este mensaje.</p>`
        });
      } else {
        console.log(`[DEV ONLY] Reset Link sent: ${resetLink}`); // For debugging without API key
      }
    }
  } catch (err) {
    console.error(err);
  }
  // Always return the same message whether user found or not for security
  res.render('club/forgot', { message: 'Si el correo existe, te enviamos un enlace de restablecimiento al correo.', error: null });
});

app.get('/club/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/club/olvide');

  const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: Date.now() } });
  if (!user) {
    return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  }

  res.render('club/reset', { error: null, token: req.query.token });
});

app.post('/club/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body;

  if (password !== confirm) {
    return res.render('club/reset', { error: 'Las contraseñas no coinciden.', token });
  }

  const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: Date.now() } });
  if (!user) {
    return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  }

  const bcryptjs = require('bcryptjs');
  user.password = await bcryptjs.hash(password, 10);
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;
  await user.save();

  res.redirect('/club/login');
});

app.post('/club/logout', (req, res) => {
  res.clearCookie('jwt');
  res.redirect('/');
});

app.get('/club/panel', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysBetween = (a, b) => Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  const reminders = (user.vehicles || []).map(v => {
    const soatD = v.soatExpires ? daysBetween(new Date(v.soatExpires + 'T00:00:00'), today) : null;
    const tecD = v.tecnoExpires ? daysBetween(new Date(v.tecnoExpires + 'T00:00:00'), today) : null;
    return { plate: v.plate, soat: soatD, tecno: tecD };
  });
  res.render('club/dashboard', { user, reminders });
});

app.post('/club/visitas', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const { date, service } = req.body;
  if (date && service) {
    user.visits.unshift({ date, service });
  }
  await user.save();
  res.redirect('/club/panel');
});

// Gestionar vehículos del usuario (para recordatorios SOAT y tecnicomecánica)
app.post('/club/vehiculos', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  if (!user.vehicles) user.vehicles = [];
  if (plate) {
    const plateUp = plate.trim().toUpperCase();
    // Unique QR payload for this vehicle (could be a URL to future check-in endpoint)
    const qrPayload = JSON.stringify({ t: 'vehicle', plate: plateUp, uid: user.id });
    user.vehicles.push({ plate: plateUp, soatExpires: soatExpires || '', tecnoExpires: tecnoExpires || '', qr: qrPayload });
  }
  await user.save();
  res.redirect('/club/panel');
});
app.post('/club/vehiculos/eliminar', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const { plate } = req.body;
  user.vehicles = (user.vehicles || []).filter(v => v.plate !== plate);
  await user.save();
  res.redirect('/club/panel');
});

// Actualizar fechas de SOAT/Tecno de un vehículo
app.post('/club/vehiculos/actualizar', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  const v = (user.vehicles || []).find(x => x.plate === (plate || '').toUpperCase());
  if (v) {
    if (typeof soatExpires !== 'undefined') v.soatExpires = soatExpires || '';
    if (typeof tecnoExpires !== 'undefined') v.tecnoExpires = tecnoExpires || '';
    // Ensure QR exists for older vehicles
    if (!v.qr) { v.qr = JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id }); }
  }
  await user.save();
  res.redirect('/club/panel');
});

// Serve vehicle QR as PNG data
app.get('/club/vehiculos/:plate/qr.png', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  const plate = (req.params.plate || '').toUpperCase();
  const v = (user.vehicles || []).find(x => x.plate === plate);
  if (!v) return res.status(404).send('No encontrado');
  const payload = v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id });
  try {
    const png = await QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', width: 384, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(500).send('Error generando QR');
  }
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

module.exports = app;

const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const csrf = require('csurf');
const catalog = require('./data/catalog');
const courses = require('./data/courses.json');

const app = express();

// Demo users (in-memory)
const users = [
  {
    id: uuidv4(),
    email: 'miembro@gorillaz.co',
    password: 'gorillaz123',
    name: 'Miembro del Club',
  role: 'admin',
    membership: {
      level: 'Premium',
      since: '2024-06-01',
      expires: '2026-06-01',
      benefits: [
        'Descuento 15% en mecánica rápida',
        'Lavado gratis cada 3 visitas',
        'Eventos y rutas exclusivas en Bogotá'
      ]
    },
    visits: [
      { date: '2025-02-15', service: 'Mecánica rápida - cambio de aceite' },
      { date: '2025-05-22', service: 'Electricidad - revisión de batería' }
    ],
    vehicles: [
      { plate: 'ABC123', soatExpires: '2025-10-10', tecnoExpires: '2025-09-15' }
    ]
  }
];

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'gorillaz-ultra-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
  })
);

// CSRF protection (cookie-less, session-based secret)
app.use(csrf());

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/favicons', express.static(path.join(__dirname, 'favicons')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Locals for templates
app.use((req, res, next) => {
  res.locals.user = users.find(u => u.id === req.session.userId);
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  const c = req.session.cart || { items: {}, count: 0, subtotal: 0 };
  // compute totals defensively without relying on other helpers
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(c.items || {})){
    const prod = (catalog.products || []).find(p => p.id === id);
    if (prod){ count += qty; subtotal += prod.price * qty; }
  }
  res.locals.cart = { items: c.items || {}, count, subtotal };
  next();
});

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  res.status(403).render('403', { message: 'Token inválido. Actualiza la página e inténtalo de nuevo.' });
});

// Helpers
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/club/login');
  next();
};
const requireAdmin = (req, res, next) => {
  const u = users.find(u => u.id === req.session.userId);
  if (!u || u.role !== 'admin') return res.status(403).render('404');
  next();
};

// Admin data stores
let events = [];
let availability = { blockedDates: [] };
let appointments = [];
try { events = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'events.json'), 'utf8')); } catch {}
try { availability = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'availability.json'), 'utf8')); } catch {}

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
  // Build slideshow images list from images/home_slideshow
  const slidesDir = path.join(__dirname, 'images', 'home_slideshow');
  let slides = [];
  try {
    const files = fs.readdirSync(slidesDir);
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
    slides = files
      .filter(f => allowed.has(path.extname(f).toLowerCase()))
      .sort()
      .map(f => `/images/home_slideshow/${encodeURIComponent(f)}`);
  } catch (e) {
    // directory may not exist yet; keep slides empty
  }
  res.render('home', {
    user: users.find(u => u.id === req.session.userId),
    slides
  });
});

app.get('/servicios', (req, res) => {
  const services = [
    'Mecánica',
    'Pintura',
    'Alistamiento tecnomecánica',
    'Electricidad',
    'Torno',
    'Prensa',
    'Mecánica rápida'
  ];
  res.render('services', { services, bookingMessage: null });
});

app.post('/servicios', (req, res) => {
  const { name, phone, service, date } = req.body;
  const services = [
    'Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida'
  ];
  const bookingMessage = (name && service && date)
    ? `Gracias ${name}. Hemos recibido tu solicitud para ${service} el ${new Date(date).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' })}. Te contactaremos al ${phone} para confirmar.`
    : 'Por favor completa todos los campos.';
  if (name && service && date){
    appointments.unshift({ id: uuidv4(), name, phone, service, date, status: 'pendiente', createdAt: new Date().toISOString() });
  }
  res.render('services', { services, bookingMessage });
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

  // Build base query string (without category) to reuse in links
  const qp = new URLSearchParams();
  if (q) qp.set('q', q);
  if (min !== null) qp.set('min', String(min));
  if (max !== null) qp.set('max', String(max));
  if (sort) qp.set('sort', sort);
  const baseQuery = qp.toString();

  res.render('shop', {
    categories,
    products,
    selectedCat,
    q,
    min: min ?? '',
    max: max ?? '',
    sort,
  baseQuery,
  priceStats
  });
});

// Cart helpers
const getCart = (req) => {
  if (!req.session.cart) req.session.cart = { items: {}, count: 0, subtotal: 0 };
  return req.session.cart;
};
const recalc = (cart) => {
  let count = 0, subtotal = 0;
  for (const [id, qty] of Object.entries(cart.items)){
    const prod = catalog.products.find(p => p.id === id);
    if (prod){ count += qty; subtotal += prod.price * qty; }
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
  cart.items[id] = (cart.items[id] || 0) + q;
  recalc(cart);
  res.redirect('/carrito');
});

// Update cart
app.post('/cart/update', (req, res) => {
  const { id, qty } = req.body;
  const cart = getCart(req);
  const q = Math.max(0, parseInt(qty || '0', 10));
  if (q === 0) delete cart.items[id]; else cart.items[id] = q;
  recalc(cart);
  res.redirect('/carrito');
});

// Clear cart
app.post('/cart/clear', (req, res) => {
  req.session.cart = { items: {}, count: 0, subtotal: 0 };
  res.redirect('/carrito');
});

// Cart page
app.get('/carrito', (req, res) => {
  const cart = recalc(getCart(req));
  const items = Object.entries(cart.items).map(([id, qty]) => {
    const p = catalog.products.find(x => x.id === id);
    return { ...p, qty, total: p.price * qty };
  });
  res.render('cart', { user: users.find(u => u.id === req.session.userId), items, cart });
});

// Checkout (mock)
app.get('/checkout', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  res.render('checkout', { user: users.find(u => u.id === req.session.userId), cart });
});

// Mock payment gateway
app.post('/pagar', (req, res) => {
  const cart = recalc(getCart(req));
  if (cart.count === 0) return res.redirect('/tienda');
  // Simulate success
  const orderId = uuidv4();
  const total = cart.subtotal;
  req.session.cart = { items: {}, count: 0, subtotal: 0 };
  res.render('payment/success', { user: users.find(u => u.id === req.session.userId), orderId, total });
});

app.get('/cursos', (req, res) => {
  res.render('courses', { list: courses });
});

app.get('/cursos/:slug', (req, res) => {
  const course = courses.find(c => c.slug === req.params.slug);
  if (!course) return res.status(404).render('404');
  res.render('course', { course });
});

// Public events page
app.get('/eventos', (req, res) => {
  res.render('events', { events });
});

// Admin dashboard
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/index', { stats: {
    users: users.length,
    events: events.length,
    citas: appointments.length,
    cursos: courses.length,
    productos: (catalog.products || []).length
  }});
});

// Admin: availability calendar
app.get('/admin/calendario', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/calendar', { availability });
});
app.post('/admin/calendario/bloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  if (date && !availability.blockedDates.includes(date)){
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
app.get('/admin/eventos', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/events', { events });
});
app.post('/admin/eventos/crear', requireAuth, requireAdmin, (req, res) => {
  const { title, date, location, description } = req.body;
  if (title && date){
    events.unshift({ id: uuidv4(), title, date, location, description });
    saveJSON('events.json', events);
  }
  res.redirect('/admin/eventos');
});
app.post('/admin/eventos/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, title, date, location, description } = req.body;
  const ev = events.find(e => e.id === id);
  if (ev){
    if (title) ev.title = title;
    if (date) ev.date = date;
    if (typeof location !== 'undefined') ev.location = location;
    if (typeof description !== 'undefined') ev.description = description;
    saveJSON('events.json', events);
  }
  res.redirect('/admin/eventos');
});
app.post('/admin/eventos/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  events = events.filter(e => e.id !== id);
  saveJSON('events.json', events);
  res.redirect('/admin/eventos');
});

// Admin: users (modify or delete)
app.get('/admin/usuarios', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/users', { users });
});
app.post('/admin/usuarios/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, name, membershipLevel } = req.body;
  const u = users.find(u => u.id === id);
  if (u){
    if (name) u.name = name;
    if (membershipLevel) u.membership.level = membershipLevel;
  }
  res.redirect('/admin/usuarios');
});
app.post('/admin/usuarios/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  const i = users.findIndex(u => u.id === id);
  if (i !== -1) users.splice(i, 1);
  res.redirect('/admin/usuarios');
});

// Admin: citas CRUD
app.get('/admin/citas', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/appointments', { appointments });
});
app.post('/admin/citas/crear', requireAuth, requireAdmin, (req, res) => {
  const { customer, date, time, service } = req.body;
  if (customer && date && time && service){
    appointments.unshift({ id: uuidv4(), customer, date, time, service, status: 'pendiente', createdAt: new Date().toISOString() });
  }
  res.redirect('/admin/citas');
});
app.post('/admin/citas/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, customer, date, time, service, status } = req.body;
  const a = appointments.find(x => x.id === id);
  if (a){
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

// Admin: cursos CRUD
app.get('/admin/cursos', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/courses', { list: courses });
});
app.post('/admin/cursos/crear', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  if (slug && title){
    courses.push({ slug, title, short: '', category: 'Técnico', level: 'Inicial', durationHours: 0, readingMinutes: 0, modality: 'Presencial', location: 'Bogotá D.C.', priceCOP: parseInt(priceCOP||'0',10)||0, tags: [], syllabus: [], outcomes: [], requirements: [], schedule: '', nextIntake: '' });
    saveJSON('courses.json', courses);
  }
  res.redirect('/admin/cursos');
});
app.post('/admin/cursos/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  const c = courses.find(x => x.slug === slug);
  if (c){
    if (title) c.title = title;
    if (typeof priceCOP !== 'undefined') c.priceCOP = parseInt(priceCOP||'0',10)||0;
    saveJSON('courses.json', courses);
  }
  res.redirect('/admin/cursos');
});
app.post('/admin/cursos/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { slug } = req.body;
  const idx = courses.findIndex(c => c.slug === slug);
  if (idx !== -1){ courses.splice(idx, 1); saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

// Admin: tienda (productos) CRUD
app.get('/admin/tienda', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/shop', { categories: catalog.categories || [], products: catalog.products || [] });
});
app.post('/admin/tienda/crear', requireAuth, requireAdmin, (req, res) => {
  const { id, name, price, category, image, description } = req.body;
  if (!catalog.products) catalog.products = [];
  const prodId = id && id.trim() ? id.trim() : uuidv4();
  if (name && category){
    catalog.products.push({ id: prodId, name, price: parseInt(price||'0',10)||0, category, image: image || '', description: description || '' });
    writeCatalog(catalog);
  }
  res.redirect('/admin/tienda');
});
app.post('/admin/tienda/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, name, price, category, image, description } = req.body;
  const p = (catalog.products || []).find(x => x.id === id);
  if (p){
    if (name) p.name = name;
    if (typeof price !== 'undefined') p.price = parseInt(price||'0',10)||0;
    if (category) p.category = category;
    if (typeof image !== 'undefined') p.image = image;
    if (typeof description !== 'undefined') p.description = description;
    writeCatalog(catalog);
  }
  res.redirect('/admin/tienda');
});
app.post('/admin/tienda/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  catalog.products = (catalog.products || []).filter(p => p.id !== id);
  writeCatalog(catalog);
  res.redirect('/admin/tienda');
});

// Legales
app.get('/privacidad', (req, res) => {
  res.render('privacy', { user: users.find(u => u.id === req.session.userId) });
});
app.get('/licencia', (req, res) => {
  res.render('license', { user: users.find(u => u.id === req.session.userId) });
});
app.get('/terminos', (req, res) => {
  res.render('terms', { user: users.find(u => u.id === req.session.userId) });
});

// Misión y Visión
app.get('/mision', (req, res) => {
  res.render('mission');
});
app.get('/vision', (req, res) => {
  res.render('vision');
});

// Club
app.get('/club', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.render('club/landing', { events });
});

app.get('/club/login', (req, res) => {
  res.render('club/login', { error: null });
});

app.post('/club/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
  req.session.userId = user.id;
  res.redirect('/club/panel');
});

// Registro (mock)
app.get('/club/registro', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.render('club/register');
});
app.post('/club/registro', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).render('club/register');
  const exists = users.find(u => u.email === email);
  if (exists) return res.status(400).render('club/register');
  const newUser = {
    id: uuidv4(), name, email, password,
    membership: { level: 'Básica', since: new Date().toISOString().slice(0,10), expires: null, benefits: ['Acceso al club'] },
    visits: []
  };
  users.push(newUser);
  req.session.userId = newUser.id;
  res.redirect('/club/panel');
});

// Olvidé mi contraseña (mock)
app.get('/club/olvide', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.render('club/forgot', { message: null });
});
app.post('/club/olvide', (req, res) => {
  const { email } = req.body;
  // Simulamos envío de enlace
  res.render('club/forgot', { message: 'Si el correo existe, te enviamos un enlace de restablecimiento.' });
});

app.post('/club/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/club/panel', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysBetween = (a, b) => Math.ceil((a.getTime() - b.getTime()) / (1000*60*60*24));
  const reminders = (user.vehicles || []).map(v => {
    const soatD = v.soatExpires ? daysBetween(new Date(v.soatExpires + 'T00:00:00'), today) : null;
    const tecD = v.tecnoExpires ? daysBetween(new Date(v.tecnoExpires + 'T00:00:00'), today) : null;
    return { plate: v.plate, soat: soatD, tecno: tecD };
  });
  res.render('club/dashboard', { user, reminders });
});

app.post('/club/visitas', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  const { date, service } = req.body;
  if (date && service) {
    user.visits.unshift({ date, service });
  }
  res.redirect('/club/panel');
});

// Gestionar vehículos del usuario (para recordatorios SOAT y tecnicomecánica)
app.post('/club/vehiculos', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  if (!user.vehicles) user.vehicles = [];
  if (plate) {
    user.vehicles.push({ plate: plate.trim().toUpperCase(), soatExpires: soatExpires || '', tecnoExpires: tecnoExpires || '' });
  }
  res.redirect('/club/panel');
});
app.post('/club/vehiculos/eliminar', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  const { plate } = req.body;
  user.vehicles = (user.vehicles || []).filter(v => v.plate !== plate);
  res.redirect('/club/panel');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

module.exports = app;

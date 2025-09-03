const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const catalog = require('./data/catalog');

const app = express();

// Demo users (in-memory)
const users = [
  {
    id: uuidv4(),
    email: 'miembro@gorillaz.co',
    password: 'gorillaz123',
    name: 'Miembro del Club',
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
  res.locals.cart = req.session.cart || { items: {}, count: 0, subtotal: 0 };
  next();
});

// Helpers
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/club/login');
  next();
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
  res.render('services', { services, user: users.find(u => u.id === req.session.userId) });
});

app.get('/tienda', (req, res) => {
  const cat = catalog.categories;
  const products = catalog.products;
  const byCat = cat.map(c => ({
    ...c,
    items: products.filter(p => p.category === c.slug)
  }));
  res.render('shop', {
    user: users.find(u => u.id === req.session.userId),
    categories: cat,
    byCat
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
  const categories = [
    { slug: 'mecanica-motos', title: 'Mecánica de Motos', desc: 'Fundamentos, mantenimiento y diagnósticos.' },
    { slug: 'electronica-motos', title: 'Electrónica de Motos', desc: 'Sistemas eléctricos, sensores e inyección.' },
    { slug: 'mecanica-rapida', title: 'Mecánica Rápida', desc: 'Servicios rápidos: frenos, llantas, aceite.' },
    { slug: 'torno', title: 'Elaboración de piezas con torno', desc: 'Fabricación y ajuste de componentes en torno.' },
  ];
  res.render('courses', { user: users.find(u => u.id === req.session.userId), categories });
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

// Club
app.get('/club', (req, res) => {
  if (req.session.userId) return res.redirect('/club/panel');
  res.redirect('/club/login');
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

app.post('/club/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/club/panel', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  res.render('club/dashboard', { user });
});

app.post('/club/visitas', requireAuth, (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  const { date, service } = req.body;
  if (date && service) {
    user.visits.unshift({ date, service });
  }
  res.redirect('/club/panel');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

module.exports = app;

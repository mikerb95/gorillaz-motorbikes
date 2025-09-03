const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

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

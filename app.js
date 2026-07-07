'use strict';
require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');

const { initDb }                    = require('./db');
const settings                      = require('./helpers/settings');
const catalogStore                  = require('./helpers/catalog');
const contentStore                  = require('./helpers/content');
const { JWT_SECRET }                = require('./config');
const { csrfToken, validateCsrf }   = require('./middleware/csrf');
const { jwtCart, templateLocals }   = require('./middleware/locals');

const app = express();
app.use((req, res, next) => { console.log('APP TOP HIT', req.method, req.originalUrl); next(); });

// En serverless (Vercel) la instancia puede congelarse antes de que un
// initDb() "fire-and-forget" termine, dejando migraciones sin aplicar. Por eso
// memoizamos la promesa y hacemos que cada petición la espere antes de tocar la BD.
let dbReady = null;
function ensureDb() {
  if (!dbReady) {
    // Tras migrar el esquema, cargamos la config editable (app_settings) a la
    // caché en memoria y luego el catálogo (que también vive en app_settings),
    // para que las lecturas síncronas funcionen desde el primer request.
    dbReady = initDb()
      .then(() => settings.loadAll())
      .then(() => { catalogStore.loadCatalog(); contentStore.loadContent(); })
      .catch(err => {
      console.error('❌ DB init error:', err);
      dbReady = null; // permite reintentar en la próxima petición
      throw err;
    });
  }
  return dbReady;
}
ensureDb();

// Cabeceras de seguridad. La CSP permite los orígenes externos que realmente usa
// el sitio (Google Fonts, reCAPTCHA, Leaflet/mapas, Vercel Blob). Mantiene
// 'unsafe-inline' en script/style porque las plantillas EJS aún dependen de
// scripts, estilos y handlers (onclick) inline; migrar a nonces es el siguiente
// paso para endurecer XSS. frame-ancestors + X-Frame-Options bloquean clickjacking.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://www.google.com', 'https://www.gstatic.com', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https://nominatim.openstreetmap.org', 'https://www.google.com', 'https://www.gstatic.com'],
      'frame-src': ["'self'", 'https://www.google.com', 'https://maps.google.com', 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
      'frame-ancestors': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'upgrade-insecure-requests': [],
    },
  },
  // Recursos estáticos (imágenes/fuentes) servidos a otros orígenes (p. ej. Blob).
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || JWT_SECRET));
app.use(csrfToken);
app.use(jwtCart);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/static',   express.static(path.join(__dirname, 'public')));
app.use('/favicons', express.static(path.join(__dirname, 'favicons')));
app.use('/images',   express.static(path.join(__dirname, 'images')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(templateLocals);
app.use(validateCsrf);

// Garantiza que el esquema y las migraciones estén listos antes de cualquier ruta.
app.use((req, res, next) => { ensureDb().then(() => next()).catch(next); });

app.use('/',       require('./routes/home'));
app.use('/',       require('./routes/liquidador'));
app.use('/',       require('./routes/services'));
app.use('/',       require('./routes/shop'));
app.use('/clasificados', require('./routes/clasificados'));
app.use('/duplicado-placas', require('./routes/duplicado-placas'));
app.use('/',       require('./routes/courses'));
app.use('/',       require('./routes/events'));
app.use('/',       require('./routes/newsletter'));
app.use('/',       require('./routes/jobs'));
app.use('/',       require('./routes/static'));
app.use('/',       require('./routes/classes'));
app.use('/',       require('./routes/checkin'));
app.use('/historial',      require('./routes/historial'));
app.use('/runt',           require('./routes/runt'));
app.use('/club',           require('./routes/club'));
app.use('/taller',         require('./routes/taller'));
app.use('/kds',            require('./routes/kds'));
app.use('/admin/finanzas', require('./routes/finanzas'));
app.get('/tv', (req, res) => res.redirect('/admin/tv'));
app.use('/admin/tv',       require('./routes/tv'));
app.use('/admin',          require('./routes/admin'));

app.use((req, res) => res.status(404).render('404'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}:`, err.message || err);
  if (res.headersSent) return next(err);
  if (status < 500) return res.status(status).render('403', { message: err.message || 'Acceso denegado.' });
  res.status(500).render('500');
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

module.exports = app;

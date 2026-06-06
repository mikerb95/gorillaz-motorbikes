'use strict';
require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');

const { initDb }                    = require('./db');
const { JWT_SECRET }                = require('./config');
const { csrfToken, validateCsrf }   = require('./middleware/csrf');
const { jwtCart, templateLocals }   = require('./middleware/locals');

const app = express();

// En serverless (Vercel) la instancia puede congelarse antes de que un
// initDb() "fire-and-forget" termine, dejando migraciones sin aplicar. Por eso
// memoizamos la promesa y hacemos que cada petición la espere antes de tocar la BD.
let dbReady = null;
function ensureDb() {
  if (!dbReady) {
    dbReady = initDb().catch(err => {
      console.error('❌ DB init error:', err);
      dbReady = null; // permite reintentar en la próxima petición
      throw err;
    });
  }
  return dbReady;
}
ensureDb();

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

app.use('/',       require('./routes/home'));
app.use('/',       require('./routes/liquidador'));
app.use('/',       require('./routes/services'));
app.use('/',       require('./routes/shop'));
app.use('/',       require('./routes/courses'));
app.use('/',       require('./routes/events'));
app.use('/',       require('./routes/newsletter'));
app.use('/',       require('./routes/jobs'));
app.use('/',       require('./routes/static'));
app.use('/',       require('./routes/classes'));
app.use('/historial',      require('./routes/historial'));
app.use('/runt',           require('./routes/runt'));
app.use('/club',           require('./routes/club'));
app.use('/taller',         require('./routes/taller'));
app.use('/admin/finanzas', require('./routes/finanzas'));
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

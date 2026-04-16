'use strict';
const rateLimit = require('express-rate-limit');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.redirect('/club/login');
  next();
};

const requireAdmin = (req, res, next) => {
  const u = res.locals.user;
  if (!u || u.role !== 'admin') return res.status(403).render('404');
  next();
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
  skipSuccessfulRequests: true,
});

module.exports = { requireAuth, requireAdmin, authLimiter };

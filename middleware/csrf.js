'use strict';
const crypto = require('crypto');

const csrfToken = (req, res, next) => {
  if (!req.cookies._csrf) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('_csrf', token, { httpOnly: false, sameSite: 'strict', maxAge: 3600000 });
    res.locals.csrfToken = token;
  } else {
    res.locals.csrfToken = req.cookies._csrf;
  }
  next();
};

const validateCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token      = req.body._csrf || req.headers['x-csrf-token'];
  const cookieToken = req.cookies._csrf;
  if (!token || token !== cookieToken) {
    return res.status(403).render('403', { message: 'Token CSRF inválido. Actualiza la página e inténtalo de nuevo.' });
  }
  next();
};

module.exports = { csrfToken, validateCsrf };

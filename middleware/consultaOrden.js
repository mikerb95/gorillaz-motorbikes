'use strict';
// Límite de intentos para consultar el estado de una orden con placa + últimos
// 4 dígitos del celular (10.000 combinaciones por placa). Una sola instancia
// para la página /mi-orden y el chat del asesor (POST /asesor/orden): si cada
// una tuviera su propio contador, un bot sumaría los dos cupos.
//
// Cuentan solo los intentos fallidos (respuesta >= 400): las rutas tienen que
// responder con 400/404 cuando la placa o los dígitos no sirven.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// IP del visitante. El sitio no configura `trust proxy`, y detrás del proxy de
// Vercel req.ip puede ser la del proxy: todos compartirían el mismo cupo. En
// Vercel, x-real-ip la escribe la plataforma (el visitante no puede
// falsificarla); fuera de Vercel se usa req.ip.
function ipVisitante(req) {
  const real = process.env.VERCEL && req.headers['x-real-ip'];
  return ipKeyGenerator(typeof real === 'string' && real ? real : req.ip || '');
}

const MENSAJE = 'Hiciste muchos intentos. Espera 15 minutos o escríbele al taller por WhatsApp.';

const consultaOrdenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyGenerator: ipVisitante,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    console.warn('[consulta-orden] rate limit por IP', ipVisitante(req));
    if (req.originalUrl.startsWith('/asesor')) return res.status(options.statusCode).json({ error: 'limite_ip' });
    const { placa } = req.body || {};
    res.status(options.statusCode).render('mi-orden', { error: MENSAJE, placaVal: placa || '', suffixVal: '' });
  },
});

module.exports = { ipVisitante, consultaOrdenLimiter };

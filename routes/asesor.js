'use strict';
// Asesor con IA de la burbuja de WhatsApp (helpers/asesor). Para responder no
// usa nada guardado: el navegador reenvía la conversación en cada pregunta.
// El límite por IP lo pone este router; el tope de gasto diario, el motor.

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { validarEntrada } = require('../helpers/asesor/bucle');
const { AsesorNoDisponible, disponible, responder } = require('../helpers/asesor/motor');

const router = express.Router();

// IP del visitante. El sitio no configura `trust proxy`, y detrás del proxy de
// Vercel req.ip puede ser la del proxy: todos compartirían el mismo cupo. En
// Vercel, x-real-ip la escribe la plataforma (el visitante no puede
// falsificarla); fuera de Vercel se usa req.ip.
function ipVisitante(req) {
  const real = process.env.VERCEL && req.headers['x-real-ip'];
  return ipKeyGenerator(typeof real === 'string' && real ? real : req.ip || '');
}

const preguntaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  keyGenerator: ipVisitante,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'limite_ip' },
  handler: (req, res, next, options) => {
    console.warn('[asesor] rate limit por IP', ipVisitante(req));
    res.status(options.statusCode).json(options.message);
  },
});

const estadoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  keyGenerator: ipVisitante,
  standardHeaders: true,
  legacyHeaders: false,
  message: { disponible: false },
});

function sinCache(res) {
  res.set('Cache-Control', 'no-store');
  return res;
}

/** La burbuja pregunta al abrirse si ofrecer la opción de IA. */
router.get('/', estadoLimiter, async (req, res) => {
  sinCache(res).json({ disponible: await disponible() });
});

router.post('/', preguntaLimiter, async (req, res) => {
  sinCache(res);
  const entrada = validarEntrada(req.body);
  if (entrada.error) return res.status(400).json(entrada);
  try {
    const r = await responder(entrada);
    res.json({ texto: r.texto, whatsapp: r.whatsapp, busquedas: r.busquedas, cifras: r.cifras });
  } catch (err) {
    if (err instanceof AsesorNoDisponible) return res.status(503).json({ error: 'no_disponible' });
    console.error('[asesor]', err && err.message ? err.message : err);
    res.status(502).json({ error: 'fallo' });
  }
});

module.exports = router;

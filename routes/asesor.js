'use strict';
// Asesor con IA de la burbuja de WhatsApp (helpers/asesor). Para responder no
// usa nada guardado: el navegador reenvía la conversación en cada pregunta.
// El límite por IP lo pone este router; el tope de gasto diario, el motor.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { ipVisitante, consultaOrdenLimiter } = require('../middleware/consultaOrden');
const { validarEntrada } = require('../helpers/asesor/bucle');
const { AsesorNoDisponible, disponible, responder } = require('../helpers/asesor/motor');
const { DatosInvalidos, buscarOrden } = require('../helpers/asesor/orden');
const { getServiceOrdersByPlate } = require('../db');
const { calcParking, loadParqueaderoConfig } = require('./services');

const router = express.Router();

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
    res.json({ texto: r.texto, whatsapp: r.whatsapp, orden: r.orden, busquedas: r.busquedas, cifras: r.cifras });
  } catch (err) {
    if (err instanceof AsesorNoDisponible) return res.status(503).json({ error: 'no_disponible' });
    console.error('[asesor]', err && err.message ? err.message : err);
    res.status(502).json({ error: 'fallo' });
  }
});

/** Estado de una moto desde el chat. No pasa por la IA (helpers/asesor/orden). */
router.post('/orden', consultaOrdenLimiter, async (req, res) => {
  sinCache(res);
  try {
    const r = await buscarOrden(req.body, {
      ordenesPorPlaca: getServiceOrdersByPlate,
      parqueadero: (o) => calcParking(o, loadParqueaderoConfig()),
    });
    // 404 cuenta para el límite: igual si no hay orden o si el celular no coincide.
    if (!r) return res.status(404).json({ error: 'no_encontrada' });
    res.json(r);
  } catch (err) {
    if (err instanceof DatosInvalidos) return res.status(400).json({ error: err.message });
    console.error('[asesor/orden]', err && err.message ? err.message : err);
    res.status(502).json({ error: 'fallo' });
  }
});

module.exports = router;

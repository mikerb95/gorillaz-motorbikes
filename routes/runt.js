'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { generarCaptcha, consultarHistorialRunt } = require('../helpers/runt');

// Estos endpoints son un proxy hacia la API oficial del RUNT. Sin límite, un
// abusador podría saturar el servidor (o quemar la cuota/IP del RUNT) a nuestro
// nombre. Límite por IP, generoso para uso normal.
const runtLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas consultas. Espera unos minutos e inténtalo de nuevo.' },
});

// GET /runt → formulario de consulta
router.get('/', (req, res) => {
  res.render('runt/consulta', {
    title: 'Consulta RUNT | Gorillaz Motorbikes',
    description: 'Consulta el SOAT y la Revisión Técnico-Mecánica de tu moto.',
    canonicalPath: '/runt',
  });
});

// GET /runt/captcha → genera y retorna imagen del captcha
router.get('/captcha', runtLimiter, async (req, res) => {
  try {
    const captcha = await generarCaptcha();
    res.json({ ok: true, idLibreCaptcha: captcha.idLibreCaptcha, imagen: captcha.imagenBase64, raw: captcha.raw });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /runt/consulta → llama la API del RUNT y retorna fechas
router.post('/consulta', runtLimiter, async (req, res) => {
  const { placa, documento, idLibreCaptcha, captcha } = req.body;

  if (!placa || !documento || !idLibreCaptcha || !captcha) {
    return res.status(400).json({ ok: false, error: 'Faltan campos requeridos.' });
  }

  const resultado = await consultarHistorialRunt(placa, documento, idLibreCaptcha, captcha);

  if (!resultado.success) {
    return res.status(400).json({ ok: false, error: resultado.error });
  }

  res.json({ ok: true, data: resultado.data });
});

module.exports = router;

'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { createCheckin } = require('../db');

const router = express.Router();

// Evita spam del formulario público (el QR queda expuesto en el mostrador).
const checkinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

router.get('/checkin', (req, res) => {
  res.render('checkin', {
    title: 'Check-in de taller | Gorillaz Motorbikes',
    description: 'Registra tu ingreso al taller escaneando este QR.',
    canonicalPath: '/checkin',
    error: null,
    ok: false,
    values: {},
  });
});

router.post('/checkin', checkinLimiter, async (req, res) => {
  const clientName = String(req.body.clientName || '').trim();
  const clientPhone = String(req.body.clientPhone || '').replace(/\D/g, '');
  const clientPhoneCountry = String(req.body.clientPhoneCountry || '+57').trim();
  const plate = String(req.body.plate || '').trim().toUpperCase().replace(/\s/g, '');
  const brand = String(req.body.brand || '').trim();
  const reference = String(req.body.reference || '').trim();

  const values = { clientName, clientPhone, clientPhoneCountry, plate, brand, reference };

  if (!clientName || clientName.length < 3) {
    return res.status(400).render('checkin', { error: 'Ingresa tu nombre completo.', ok: false, values });
  }
  if (!clientPhone || clientPhone.length < 7) {
    return res.status(400).render('checkin', { error: 'Ingresa un número de WhatsApp válido.', ok: false, values });
  }
  if (!plate || plate.length < 4) {
    return res.status(400).render('checkin', { error: 'Ingresa la placa de tu moto.', ok: false, values });
  }
  if (!brand) {
    return res.status(400).render('checkin', { error: 'Ingresa la marca de tu moto.', ok: false, values });
  }
  if (!reference) {
    return res.status(400).render('checkin', { error: 'Ingresa la referencia de tu moto.', ok: false, values });
  }

  await createCheckin({
    clientName: clientName.slice(0, 120),
    clientPhone: clientPhone.slice(0, 15),
    clientPhoneCountry,
    plate: plate.slice(0, 20),
    brand: brand.slice(0, 60),
    reference: reference.slice(0, 60),
  });

  res.render('checkin', { error: null, ok: true, values: {} });
});

module.exports = router;

'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { getServiceOrdersByPlate } = require('../db');

const router = express.Router();

const buscarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

// Statuses considered "active" (not yet closed).
const ACTIVE_STATUSES = new Set([
  'pendiente', 'ingreso_taller', 'trabajo_en_curso', 'en_pausa', 'trabajo_completo',
]);

function last4(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

router.get('/', (req, res) => {
  res.render('consultar', {
    title: 'Consultar estado de mi moto | Gorillaz Motorbikes',
    description: 'Verifica en tiempo real el estado de tu motocicleta en el taller Gorillaz Motorbikes.',
    canonicalPath: '/consultar',
  });
});

router.post('/buscar', buscarLimiter, async (req, res) => {
  const { placa, wa4 } = req.body || {};

  if (!placa || typeof placa !== 'string' || placa.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'Ingresa una placa válida.' });
  }
  if (!wa4 || !/^\d{4}$/.test(String(wa4).trim())) {
    return res.status(400).json({ ok: false, error: 'Ingresa los últimos 4 dígitos de tu WhatsApp.' });
  }

  const clean = placa.trim().toUpperCase().replace(/\s/g, '');
  const orders = await getServiceOrdersByPlate(clean);

  if (!orders.length) {
    return res.status(404).json({ ok: false, error: 'No se encontró información para estos datos.' });
  }

  // Find the most recent active order; fall back to most recent overall.
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const order  = sorted.find(o => ACTIVE_STATUSES.has(o.status)) || sorted[0];

  // Validate last-4 digits (same error on mismatch to avoid enumeration).
  if (last4(order.clientPhone) !== String(wa4).trim()) {
    return res.status(404).json({ ok: false, error: 'No se encontró información para estos datos.' });
  }

  res.json({
    ok: true,
    order: {
      label:         order.label,
      status:        order.status,
      mechanic:      order.mechanic || null,
      estimatedDate: order.estimatedDate || null,
      createdAt:     order.createdAt,
      items:         (order.items || []).map(it => ({ name: it.name || it.label || '—', qty: it.qty || it.quantity || 1 })),
      total:         order.total || 0,
      notes:         order.notes || null,
    },
  });
});

module.exports = router;

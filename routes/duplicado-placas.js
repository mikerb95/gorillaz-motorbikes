'use strict';
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { setFlash } = require('../helpers/flash');
const { createPlateRequest } = require('../db');

const router = express.Router();

const TYPES   = ['placa_carro', 'placa_moto', 'placa_publico', 'portaplacas'];
const REASONS = ['perdida', 'hurto', 'deterioro'];

// Evita spam de solicitudes desde la misma IP.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Has alcanzado el límite de solicitudes por hora. Escríbenos por WhatsApp.',
});

// Normaliza y valida los campos del formulario. Devuelve { data } o { error }.
function parseForm(body) {
  const type          = (body.type || '').toString().trim();
  const reason        = (body.reason || '').toString().trim();
  const plate         = (body.plate || '').toString().trim().toUpperCase().slice(0, 10);
  const vehicleBrand  = (body.vehicleBrand || '').toString().trim().slice(0, 60);
  const customerName  = (body.customerName || '').toString().trim();
  const customerPhone = (body.customerPhone || '').toString().trim();
  const customerEmail = (body.customerEmail || '').toString().trim();
  const city          = (body.city || '').toString().trim();
  const department     = (body.department || '').toString().trim();
  const notes          = (body.notes || '').toString().trim().slice(0, 1000);

  if (!TYPES.includes(type))
    return { error: 'Selecciona qué necesitas: duplicado de placa o portaplacas.' };
  if (type !== 'portaplacas' && !REASONS.includes(reason))
    return { error: 'Selecciona el motivo del duplicado.' };
  if (customerName.length < 3 || customerName.length > 80)
    return { error: 'Escribe tu nombre completo.' };
  if (!/^[+\d\s\-()]{7,25}$/.test(customerPhone))
    return { error: 'El teléfono no es válido.' };
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
    return { error: 'El correo no es válido.' };

  return {
    data: {
      type, reason: type === 'portaplacas' ? '' : reason, plate, vehicleBrand,
      customerName, customerPhone, customerEmail, city, department, notes,
    },
  };
}

router.get('/', (req, res) => {
  res.render('duplicado-placas/index', {
    title: 'Duplicado de placas y portaplacas | Gorillaz Motorbikes',
    error: null, form: null,
  });
});

router.post('/solicitar', requestLimiter, async (req, res, next) => {
  try {
    const parsed = parseForm(req.body);
    if (parsed.error) {
      return res.status(400).render('duplicado-placas/index', {
        title: 'Duplicado de placas y portaplacas | Gorillaz Motorbikes',
        error: parsed.error, form: req.body,
      });
    }
    await createPlateRequest({ ...parsed.data, status: 'pendiente' });
    setFlash(res, 'success', '¡Solicitud recibida! Nuestro equipo te contactará por WhatsApp para continuar con el trámite.');
    res.redirect('/duplicado-placas#solicitar');
  } catch (e) { next(e); }
});

module.exports = router;

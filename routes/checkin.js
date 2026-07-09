'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const QRCode    = require('qrcode');
const { createCheckin, getPendingAppointmentByPlate, getPendingCheckinsByPlate, updateAppointment } = require('../db');

const router = express.Router();
const BASE_URL = process.env.BASE_URL || 'https://gorillazmotorbikes.com';

// Normaliza la placa igual en agendar/lookup/confirmar: mayúsculas y sin espacios.
const normalizePlate = (v) => String(v || '').trim().toUpperCase().replace(/\s/g, '');

// Fecha de la cita (guardada como 'YYYY-MM-DD' o ISO) para mostrar al cliente.
// Se formatea en UTC para que una fecha «solo día» no se corra un día por la
// zona horaria de Colombia (−5h).
function citaDateLabel(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// QR fijo para imprimir y pegar en el mostrador del taller.
router.get('/checkin/qr.png', async (req, res) => {
  const png = await QRCode.toBuffer(`${BASE_URL}/checkin`, { type: 'png', errorCorrectionLevel: 'M', width: 512, margin: 2 });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(png);
});

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

// Consulta por placa desde el formulario por pasos: ¿este cliente ya tenía una
// cita agendada? Si es así, el front ofrece "confirmar asistencia" en vez de
// pedirle de nuevo todos los datos. Solo lectura, con límite anti-abuso propio.
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas. Espera unos minutos.' },
});

router.get('/checkin/lookup', lookupLimiter, async (req, res) => {
  const plate = normalizePlate(req.query.placa);
  if (plate.length < 4) return res.json({ ok: false, hasAppointment: false });

  const [appointment, pendingCheckins] = await Promise.all([
    getPendingAppointmentByPlate(plate),
    getPendingCheckinsByPlate(plate),
  ]);
  const alreadyCheckedIn = pendingCheckins.some(c => normalizePlate(c.plate) === plate);

  if (!appointment) return res.json({ ok: true, hasAppointment: false, alreadyCheckedIn });

  return res.json({
    ok: true,
    hasAppointment: true,
    alreadyCheckedIn,
    appointment: {
      name: appointment.name || '',
      service: appointment.service || '',
      dateLabel: citaDateLabel(appointment.date),
    },
  });
});

// Confirmar asistencia de una cita: crea el check-in con los datos de la cita
// (entra a la fila del taller) y marca la cita como 'confirmada'. Idempotente:
// se identifica la cita por placa (una vez confirmada ya no es 'pendiente') y
// no se duplica el check-in si ya hay uno pendiente para esa placa.
router.post('/checkin/confirmar', checkinLimiter, async (req, res) => {
  const plate = normalizePlate(req.body.plate);
  if (plate.length < 4) return res.status(400).json({ ok: false, error: 'Placa inválida.' });

  const appointment = await getPendingAppointmentByPlate(plate);
  if (!appointment) {
    // Ya estaba confirmada (o desapareció): no es un error para el cliente.
    return res.json({ ok: true, already: true });
  }

  const existing = await getPendingCheckinsByPlate(plate);
  const alreadyQueued = existing.some(c => normalizePlate(c.plate) === plate);
  if (!alreadyQueued) {
    const phone = String(appointment.phone || '').replace(/\D/g, '');
    await createCheckin({
      clientName: (appointment.name || 'Cliente con cita').slice(0, 120),
      clientPhone: phone.slice(0, 15) || '0000000',
      clientPhoneCountry: '+57',
      plate: plate.slice(0, 20),
      brand: null,
      reference: appointment.service ? `Cita: ${appointment.service}`.slice(0, 60) : null,
    });
  }

  await updateAppointment(appointment.id, { status: 'confirmada' });
  return res.json({ ok: true });
});

module.exports = router;

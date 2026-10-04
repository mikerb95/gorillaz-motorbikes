'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createAppointment, getServiceOrdersByPlate } = require('../db');
const { computeDemandMap } = require('../helpers/appointments');
const { resendClient } = require('../config');

const settings = require('../helpers/settings');
const PARQUEADERO_CONFIG_PATH = path.join(__dirname, '..', 'data', 'parqueadero-config.json');
// La config canónica vive en app_settings (clave 'parqueadero'); el archivo
// JSON queda solo como fallback de lectura previo a la primera edición.
function loadParqueaderoConfig() {
  const cfg = settings.get('parqueadero');
  if (cfg !== undefined) return cfg;
  try { return JSON.parse(fs.readFileSync(PARQUEADERO_CONFIG_PATH, 'utf8')); }
  catch { return { diasGratis: 3, tarifaPorDia: 7000 }; }
}

function calcParking(order, config) {
  if (!order.trabajoCompletoAt) return { aplica: false };
  const tcAt = new Date(order.trabajoCompletoAt);
  const now = new Date();
  const diasTotal = Math.floor((now - tcAt) / (1000 * 60 * 60 * 24));
  const diasGratis = config.diasGratis;
  const tarifaPorDia = config.tarifaPorDia;
  const diasCobro = Math.max(0, diasTotal - diasGratis);
  const totalParq = diasCobro * tarifaPorDia;
  const diasRestantes = Math.max(0, diasGratis - diasTotal);
  return { aplica: diasCobro > 0, diasTotal, diasGratis, tarifaPorDia, diasCobro, totalParq, diasRestantes };
}

const router = express.Router();
const SERVICES = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos', 'Lavado de motos', 'Detailing de motos', 'Lavado de cascos'];

// Ficha de cada servicio (includes, textos, fotos): data/services-detail.js.
// El asesor con IA (helpers/asesor) lee la misma lista.
const servicesData = require('../data/services-detail');

// /servicios: el tablero de herramientas. Mismo orden que la home (el recorrido
// de la moto por sistemas) y el nombre corto de cada servicio, que es el valor
// que entiende el selector de /servicios/agendar.
const landingServices = require('../data/landing-services');
router.get('/servicios', (req, res) => {
  const bySlug = Object.fromEntries(servicesData.map(s => [s.slug, s]));
  const services = landingServices
    .filter(l => bySlug[l.slug])
    .map(l => ({ ...bySlug[l.slug], name: l.name, detailHref: `/servicios/${l.slug}` }));
  res.render('services', {
    services,
    title: 'Servicios | Gorillaz Motorbikes',
    description: 'Mecánica, electricidad, escaneo, torno, prensa, pintura, lavado y detailing de motos en Bogotá. Mira qué incluye cada servicio y agenda en línea.',
    canonicalPath: '/servicios',
    bodyClass: 'page-servicios',
  });
});

router.get('/servicios/agendar', async (req, res) => {
  // ?servicio=<nombre> (desde /servicios o la home) preselecciona el servicio.
  const preselect = SERVICES.includes(req.query.servicio) ? req.query.servicio : null;
  try {
    res.render('services_schedule', { services: SERVICES, bookingMessage: null, demandMap: await computeDemandMap(), preselect });
  } catch (e) {
    console.error('GET /servicios/agendar error:', e.message);
    res.status(500).render('services_schedule', { services: SERVICES, bookingMessage: null, demandMap: {} });
  }
});

router.post('/servicios/agendar', async (req, res) => {
  try {
    const { name, email, phone, service, date } = req.body;
    const plate = String(req.body.plate || '').trim().toUpperCase().replace(/\s/g, '');
    const demandMap = await computeDemandMap();
    if (!name || !service || !date || !email || !plate) {
      return res.render('services_schedule', { services: SERVICES, bookingMessage: 'Por favor completa todos los campos.', demandMap });
    }
    const formattedDate = new Date(date).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    await createAppointment({ id: uuidv4(), name, email, phone, service, date, plate: plate.slice(0, 20), status: 'pendiente' });
    try {
      if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_TU_API_KEY_AQUI') {
        const clientHtml = `<p>Hola <strong>${name}</strong>,</p><p>Hemos recibido tu solicitud de cita para <strong>${service}</strong> el <strong>${formattedDate}</strong>.</p><p>Nuestro equipo te contactará al número <strong>${phone}</strong> para confirmar la cita.</p><p>Gracias por confiar en Gorillaz Motorbikes.</p>`;
        const bookingHtml = `<p><strong>Nueva solicitud de cita</strong></p><ul><li><strong>Cliente:</strong> ${name}</li><li><strong>Email:</strong> ${email}</li><li><strong>Teléfono:</strong> ${phone}</li><li><strong>Placa:</strong> ${plate}</li><li><strong>Servicio:</strong> ${service}</li><li><strong>Fecha solicitada:</strong> ${formattedDate}</li></ul>`;
        await Promise.allSettled([
          resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: email, subject: `Confirmación de cita — ${service}`, html: clientHtml }),
          resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com', subject: `Nueva cita: ${service} — ${name}`, html: bookingHtml }),
        ]);
      }
    } catch (e) { console.error('Resend error:', e.message); }
    res.render('services_schedule', { services: SERVICES, bookingMessage: `Gracias ${name}. Confirmación enviada a ${email}. Te contactaremos al ${phone}.`, demandMap: await computeDemandMap() });
  } catch (e) {
    console.error('POST /servicios/agendar error:', e.message);
    res.status(500).render('services_schedule', { services: SERVICES, bookingMessage: 'Error al procesar la solicitud. Por favor intenta de nuevo.', demandMap: {} });
  }
});

router.get('/servicios/lavado-motos', (req, res) => res.render('services/lavado-motos'));
router.get('/servicios/lavado-cascos', (req, res) => res.render('services/lavado-cascos'));
router.get('/servicios/detailing-motos', (req, res) => res.render('services/detailing-motos'));

router.get('/servicios/:slug', (req, res, next) => {
  const service = servicesData.find(s => s.slug === req.params.slug);
  if (!service) return next(); // Not found, move to 404 handler
  res.render('services/service-detail', { service, title: `${service.title} — Gorillaz Motorbikes` });
});

router.get(['/agendar-servicio', '/servicios/agenda', '/agenda-servicio', '/agenda'], (req, res) => res.redirect('/servicios/agendar'));

// ── Mi Orden (consulta pública de orden de servicio) ──────────────────────

router.get('/mi-orden', (req, res) => {
  res.render('mi-orden');
});

router.post('/mi-orden', async (req, res) => {
  const { placa, phone_suffix } = req.body;

  if (!placa || !phone_suffix) {
    return res.render('mi-orden', { error: 'Por favor completa todos los campos.', placaVal: placa || '', suffixVal: phone_suffix || '' });
  }

  const suffix = phone_suffix.replace(/\D/g, '').slice(-3);
  if (suffix.length !== 3) {
    return res.render('mi-orden', { error: 'Ingresa exactamente los últimos 3 dígitos de tu celular.', placaVal: placa, suffixVal: phone_suffix });
  }

  try {
    const orders = await getServiceOrdersByPlate(placa.trim());

    if (orders.length === 0) {
      return res.render('mi-orden', { error: 'No encontramos ninguna orden para esa placa. Verifica que esté bien escrita o consulta en el taller.', placaVal: placa, suffixVal: phone_suffix });
    }

    const order = orders.find(o => {
      const phone = (o.clientPhone || '').replace(/\D/g, '');
      return phone.slice(-3) === suffix;
    });

    if (!order) {
      return res.render('mi-orden', { error: 'Los datos no coinciden. Verifica la placa y los últimos 3 dígitos de tu celular.', placaVal: placa, suffixVal: phone_suffix });
    }

    const parking = calcParking(order, loadParqueaderoConfig());
    res.render('mi-orden', { order, parking, placaVal: placa, suffixVal: phone_suffix });
  } catch (e) {
    console.error('POST /mi-orden error:', e.message);
    res.render('mi-orden', { error: 'Error al consultar. Por favor intenta de nuevo.', placaVal: placa, suffixVal: phone_suffix });
  }
});

module.exports = router;
module.exports.calcParking = calcParking;
module.exports.loadParqueaderoConfig = loadParqueaderoConfig;

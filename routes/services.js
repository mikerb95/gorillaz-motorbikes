'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createAppointment, getServiceOrdersByPlate } = require('../db');
const { computeDemandMap } = require('../helpers/appointments');
const { resendClient } = require('../config');

const settings = require('../helpers/settings');
const { DatosInvalidos, ordenDelCliente } = require('../helpers/asesor/orden');
const { consultaOrdenLimiter } = require('../middleware/consultaOrden');
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
function boardServices() {
  const bySlug = Object.fromEntries(servicesData.map(s => [s.slug, s]));
  return landingServices
    .filter(l => bySlug[l.slug])
    .map(l => ({ ...bySlug[l.slug], name: l.name, detailHref: `/servicios/${l.slug}` }));
}
router.get('/servicios', (req, res) => {
  res.render('services', {
    services: boardServices(),
    title: 'Servicios de taller de motos en Bogotá | Gorillaz Motorbikes',
    description: 'Mecánica, electricidad, escaneo, torno, prensa, pintura, lavado y detailing de motos en Bogotá. Mira qué incluye cada servicio y agenda en línea.',
    canonicalPath: '/servicios',
    bodyClass: 'page-servicios',
    vtExpect: 'sv-cards-end',
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

// Ficha ampliada de un servicio: la misma ficha de /servicios, en grande y con
// el tablero debajo. Entre las dos páginas hay una transición de vista que
// lleva la herramienta de un sitio al otro (public/js/servicios/vt.js).
// Título para buscadores: lo que la gente escribe en Google ("pintura de
// motos en Bogotá"), no el nombre comercial de la ficha.
function seoServiceTitle(name) {
  if (/motos|cascos/i.test(name)) return `${name} en Bogotá`;
  if (/^(torno|prensa)$/i.test(name)) return `${name} para motos en Bogotá`;
  return `${name} de motos en Bogotá`;
}

router.get('/servicios/:slug', (req, res, next) => {
  const services = boardServices();
  const index = services.findIndex(s => s.slug === req.params.slug);
  if (index < 0) return next(); // Not found, move to 404 handler
  const service = services[index];
  const { getServiceInfo } = require('../helpers/service-info');
  const { productsForService } = require('../helpers/shop/crosssell');
  const { unitPrice } = require('../helpers/shop/pricing');
  const { isClubMember } = require('../helpers/cart');
  const member = isClubMember(res.locals.user);
  res.render('services/service-detail', {
    service, services, index,
    serviceInfo: getServiceInfo(service.slug),
    suggestedProducts: productsForService(service.slug),
    priceOf: (p) => unitPrice(p, null, { member }),
    waContext: res.locals.waMsg.service({ name: service.name, url: `${res.locals.siteUrl}/servicios/${service.slug}` }),
    title: `${seoServiceTitle(service.name)} | Gorillaz Motorbikes`,
    description: `${service.desc} Taller de motos en Bogotá, agenda en línea.`,
    canonicalPath: `/servicios/${service.slug}`,
    bodyClass: 'page-servicios page-servicio',
    vtExpect: 'sv-detail-end',
  });
});

router.get(['/agendar-servicio', '/servicios/agenda', '/agenda-servicio', '/agenda'], (req, res) => res.redirect('/servicios/agendar'));

// ── Mi Orden (consulta pública de orden de servicio) ──────────────────────

router.get('/mi-orden', (req, res) => {
  res.render('mi-orden');
});

// Placa + últimos 4 dígitos del celular, con la misma búsqueda y el mismo
// límite de intentos que el chat del asesor (helpers/asesor/orden.js,
// middleware/consultaOrden.js). Los errores responden 400/404 para que
// cuenten en el límite, y "no hay orden" y "el celular no coincide" dicen lo
// mismo: el formulario no sirve para averiguar qué placas tienen orden.
router.post('/mi-orden', consultaOrdenLimiter, async (req, res) => {
  const { placa, phone_suffix } = req.body || {};
  const vista = (status, datos) => res.status(status).render('mi-orden', { placaVal: placa || '', suffixVal: phone_suffix || '', ...datos });

  try {
    const order = await ordenDelCliente({ placa, digitos: phone_suffix }, getServiceOrdersByPlate);
    if (!order) {
      return vista(404, { error: 'No encontramos una orden con esa placa y esos dígitos. Verifícalos o consulta en el taller.' });
    }
    vista(200, { order, parking: calcParking(order, loadParqueaderoConfig()) });
  } catch (e) {
    if (e instanceof DatosInvalidos) {
      return vista(400, {
        error: e.message === 'placa'
          ? 'Revisa la placa: son 3 letras y 3 caracteres, por ejemplo ABC12D.'
          : 'Ingresa exactamente los últimos 4 dígitos de tu celular.',
      });
    }
    console.error('POST /mi-orden error:', e.message);
    vista(500, { error: 'Error al consultar. Por favor intenta de nuevo.' });
  }
});

module.exports = router;
module.exports.calcParking = calcParking;
module.exports.loadParqueaderoConfig = loadParqueaderoConfig;

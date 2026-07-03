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
const SERVICES = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];

const servicesData = [
  {
    slug: 'mecanica',
    title: 'Mecánica Especializada y Mantenimiento',
    desc: 'Diagnóstico, mantenimiento preventivo y correctivo. Trabajamos con control de calidad para que tu moto rinda al máximo.',
    img: '/images/services/mecanica.webp',
    details: 'Nuestro servicio de <strong>mecánica para motos</strong> incluye una revisión completa de sistemas de frenos, transmisión, refrigeración y motor. Contamos con herramientas especializadas y protocolos de calidad que garantizan que tu moto salga lista para la ruta o la ciudad de forma segura.'
  },
  {
    slug: 'pintura',
    title: 'Pintura y Restauración Estética',
    desc: 'Acabados profesionales, retoques y protección. Cuidamos el detalle y la durabilidad.',
    img: '/images/services/pintura.webp',
    details: 'Reparamos rayones, abolladuras y restauramos el color original o aplicamos pintura personalizada según tus requerimientos. Usamos pinturas de alta resistencia y acabados con barniz protector de la mayor durabilidad.'
  },
  {
    slug: 'alistamiento-tecnomecanica',
    title: 'Alistamiento Tecnomecánica',
    desc: 'Revisión integral y ajustes previos a la inspección para evitar sorpresas y rechazos.',
    img: '/images/services/alisamiento.webp',
    details: 'Realizamos inspección de gases, frenos, luces, desgaste de llantas y nivel sonoro. Garantizamos que tu moto apruebe la revisión técnico mecánica reglamentaria al primer intento.'
  },
  {
    slug: 'electricidad',
    title: 'Servicio de Electricidad',
    desc: 'Sistema de carga, arranque e iluminación. Diagnóstico electrónico confiable.',
    img: '/images/services/electricidad.webp',
    details: 'Arreglamos cortos circuitos, adaptaciones de exploradoras, problemas en la batería y estatores. Tu seguridad nocturna y el encendido de la moto están garantizados.'
  },
  {
    slug: 'torno',
    title: 'Torno y Fresado',
    desc: 'Fabricación y ajuste de componentes a medida según especificación.',
    img: '/images/services/torno.webp',
    details: 'Diseñamos y reparamos bujes, ejes, roscas dañadas y realizamos soldaduras especializadas. Si una pieza ya no se consigue, nosotros la fabricamos.' //
  },
  {
    slug: 'prensa',
    title: 'Servicio de Prensa',
    desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.',
    img: '/images/services/prensa.webp',
    details: 'Extraemos rodamientos, cunas de dirección y pasadores empleando prensas hidráulicas, con lo que evitamos golpear y deformar tu moto.'
  },
  {
    slug: 'mecanica-rapida',
    title: 'Mecánica Rápida (Express)',
    desc: 'Servicios ágiles como cambios de aceite y ajustes menores con cita.',
    img: '/images/services/mecanica-rapida.webp',
    details: 'Cambio de aceite, pastillas de freno, tensado y lubricación de cadena en tiempo récord para que sigas rodando sin perder tu día.'
  },
  {
    slug: 'escaneo-de-motos',
    title: 'Escaneo de Motos (Inyección)',
    desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.',
    img: '/images/services/scaneo.webp',
    details: 'Contamos con escáneres multimarca para apagar testigos de motor, chequear valores en tiempo real de inyectores, sensores TPS y módulos ABS.'
  },
  // Servicios que usan sus propias vistas personalizadas
  { slug: 'lavado-motos', title: 'Lavado de motos', desc: 'Limpieza profunda con productos especializados para cuidar la pintura y componentes de tu máquina.', img: '/images/services/lavado-motos.png' },
  { slug: 'lavado-cascos', title: 'Lavado de cascos', desc: 'Desinfección y limpieza interna y externa para mantener tu seguridad y confort al rodar.', img: '/images/services/lavado-cascos.webp' },
  { slug: 'detailing-motos', title: 'Detailing de motos', desc: 'Restauración estética detallada, polichado y protección cerámica para un brillo único.', img: '/images/services/detailing-motos.webp' }
];

router.get('/servicios', (req, res) => {
  res.render('services', { services: servicesData });
});

router.get('/servicios/agendar', async (req, res) => {
  try {
    res.render('services_schedule', { services: SERVICES, bookingMessage: null, demandMap: await computeDemandMap() });
  } catch (e) {
    console.error('GET /servicios/agendar error:', e.message);
    res.status(500).render('services_schedule', { services: SERVICES, bookingMessage: null, demandMap: {} });
  }
});

router.post('/servicios/agendar', async (req, res) => {
  try {
    const { name, email, phone, service, date } = req.body;
    const demandMap = await computeDemandMap();
    if (!name || !service || !date || !email) {
      return res.render('services_schedule', { services: SERVICES, bookingMessage: 'Por favor completa todos los campos.', demandMap });
    }
    const formattedDate = new Date(date).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    await createAppointment({ id: uuidv4(), name, email, phone, service, date, status: 'pendiente' });
    try {
      if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_TU_API_KEY_AQUI') {
        const clientHtml = `<p>Hola <strong>${name}</strong>,</p><p>Hemos recibido tu solicitud de cita para <strong>${service}</strong> el <strong>${formattedDate}</strong>.</p><p>Nuestro equipo te contactará al número <strong>${phone}</strong> para confirmar la cita.</p><p>Gracias por confiar en Gorillaz Motorbikes.</p>`;
        const bookingHtml = `<p><strong>Nueva solicitud de cita</strong></p><ul><li><strong>Cliente:</strong> ${name}</li><li><strong>Email:</strong> ${email}</li><li><strong>Teléfono:</strong> ${phone}</li><li><strong>Servicio:</strong> ${service}</li><li><strong>Fecha solicitada:</strong> ${formattedDate}</li></ul>`;
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

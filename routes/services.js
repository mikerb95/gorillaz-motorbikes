'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createAppointment } = require('../db');
const { computeDemandMap }  = require('../helpers/appointments');
const { resendClient }      = require('../config');

const router  = express.Router();
const SERVICES = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];

router.get('/servicios', (req, res) => {
  const services = [
    { slug: 'lavado-motos',               title: 'Lavado de motos',               desc: 'Limpieza profunda con productos especializados para cuidar la pintura y componentes de tu máquina.',                   img: '/images/services/lavado-motos.png' },
    { slug: 'lavado-cascos',              title: 'Lavado de cascos',              desc: 'Desinfección y limpieza interna y externa para mantener tu seguridad y confort al rodar.',                           img: '/images/services/lavado-cascos.webp' },
    { slug: 'detailing-motos',            title: 'Detailing de motos',            desc: 'Restauración estética detallada, polichado y protección cerámica para un brillo único.',                            img: '/images/services/detailing-motos.webp' },
    { slug: 'mecanica',                   title: 'Mecánica',                      desc: 'Diagnóstico, mantenimiento preventivo y correctivo. Trabajamos con control de calidad para que tu moto rinda al máximo.', img: '/images/services/mecanica.webp' },
    { slug: 'pintura',                    title: 'Pintura',                       desc: 'Acabados profesionales, retoques y protección. Cuidamos el detalle y la durabilidad.',                              img: '/images/services/pintura.webp' },
    { slug: 'alistamiento-tecnomecanica', title: 'Alistamiento tecnomecánica',    desc: 'Revisión integral y ajustes previos a la inspección para evitar sorpresas y rechazos.',                            img: '/images/services/alistamiento.webp' },
    { slug: 'electricidad',               title: 'Electricidad',                  desc: 'Sistema de carga, arranque e iluminación. Diagnóstico electrónico confiable.',                                      img: '/images/services/electricidad.webp' },
    { slug: 'torno',                      title: 'Torno',                         desc: 'Fabricación y ajuste de componentes a medida según especificación.',                                                 img: '/images/services/torno.webp' },
    { slug: 'prensa',                     title: 'Prensa',                        desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.',                                                     img: '/images/services/prensa.webp' },
    { slug: 'mecanica-rapida',            title: 'Mecánica rápida',               desc: 'Servicios ágiles como cambios de aceite y ajustes menores con cita.',                                               img: '/images/services/mecanica-rapida.webp' },
    { slug: 'escaneo-de-motos',           title: 'Escaneo de motos',              desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.',                                        img: '/images/services/scaneo.webp' },
  ];
  res.render('services', { services });
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
        const clientHtml  = `<p>Hola <strong>${name}</strong>,</p><p>Hemos recibido tu solicitud de cita para <strong>${service}</strong> el <strong>${formattedDate}</strong>.</p><p>Nuestro equipo te contactará al número <strong>${phone}</strong> para confirmar la cita.</p><p>Gracias por confiar en Gorillaz Motorbikes.</p>`;
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

router.get('/servicios/lavado-motos',    (req, res) => res.render('services/lavado-motos'));
router.get('/servicios/lavado-cascos',   (req, res) => res.render('services/lavado-cascos'));
router.get('/servicios/detailing-motos', (req, res) => res.render('services/detailing-motos'));

router.get(['/agendar-servicio', '/servicios/agenda', '/agenda-servicio', '/agenda'], (req, res) => res.redirect('/servicios/agendar'));

module.exports = router;

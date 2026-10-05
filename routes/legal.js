'use strict';
// Páginas legales y de políticas comerciales (helpers/legal.js) y el
// formulario de PQRS. Se enlazan desde el footer, la ficha y el checkout.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');
const { LEGAL_DOCS, LEGAL_UPDATED, COMPANY } = require('../helpers/legal');
const { getDeliveryConfig, availableMethods, activeZones, METHOD_LABELS } = require('../helpers/shop/delivery');
const { resendClient } = require('../config');
const { esc, mailEnabled } = require('../helpers/shop/emails');
const { verifyRecaptcha } = require('../helpers/recaptcha');

const router = express.Router();
const pqrsLimiter = rateLimit({ windowMs: 60 * 60_000, max: 8, standardHeaders: true, legacyHeaders: false });

const PQRS_KINDS = { peticion: 'Petición', queja: 'Queja', reclamo: 'Reclamo', sugerencia: 'Sugerencia', garantia: 'Garantía', retracto: 'Retracto' };

function legalLocals(doc, extra = {}) {
  const delivery = getDeliveryConfig();
  return {
    doc,
    docs: LEGAL_DOCS,
    updated: LEGAL_UPDATED,
    company: COMPANY,
    delivery,
    deliveryMethods: availableMethods(delivery),
    zones: activeZones(delivery),
    METHOD_LABELS,
    PQRS_KINDS,
    title: `${doc.title} | Gorillaz Motorbikes`,
    description: doc.description,
    canonicalPath: doc.path,
    ...extra,
  };
}

for (const doc of LEGAL_DOCS) {
  router.get(doc.path, (req, res) => res.render(doc.view, legalLocals(doc, { form: {}, sent: req.query.radicado || null })));
}

router.post('/pqrs', pqrsLimiter, async (req, res) => {
  const doc = LEGAL_DOCS.find((d) => d.path === '/pqrs');
  const clean = (v, n) => String(v || '').trim().slice(0, n);
  const form = {
    kind: PQRS_KINDS[req.body.kind] ? req.body.kind : '',
    name: clean(req.body.name, 120), email: clean(req.body.email, 160).toLowerCase(),
    phone: clean(req.body.phone, 30), orderRef: clean(req.body.orderRef, 40), message: clean(req.body.message, 4000),
  };
  const errors = [];
  if (!form.kind) errors.push('Elige el tipo de solicitud.');
  if (!form.name) errors.push('Escribe tu nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) errors.push('Escribe un correo válido para responderte.');
  if (form.message.length < 10) errors.push('Cuéntanos tu solicitud con un poco más de detalle.');
  if (req.body.acepto !== '1') errors.push('Debes autorizar el tratamiento de tus datos para tramitar la solicitud.');
  const captchaOk = await verifyRecaptcha(req.body['g-recaptcha-response'], req.ip).catch(() => false);
  if (!captchaOk) errors.push('Confirma que no eres un robot.');
  if (errors.length) return res.status(400).render(doc.view, legalLocals(doc, { form, errors, sent: null }));

  const radicado = `PQRS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  await db.execute({
    sql: 'INSERT INTO pqrs (id, radicado, kind, name, email, phone, order_ref, message) VALUES (?,?,?,?,?,?,?,?)',
    args: [uuidv4(), radicado, form.kind, form.name, form.email, form.phone || null, form.orderRef || null, form.message],
  });

  if (mailEnabled()) {
    const to = process.env.PQRS_EMAIL || process.env.ORDERS_EMAIL || process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com';
    const body = `<p><strong>${esc(PQRS_KINDS[form.kind])}</strong> radicada con el número <strong>${esc(radicado)}</strong>.</p>
      <p>${esc(form.name)} &lt;${esc(form.email)}&gt; ${esc(form.phone)} ${form.orderRef ? `· Ref. ${esc(form.orderRef)}` : ''}</p>
      <p style="white-space:pre-wrap">${esc(form.message)}</p>`;
    Promise.allSettled([
      resendClient.emails.send({ from: 'Gorillaz Motorbikes <tienda@gorillazmotorbikes.com>', to, subject: `${PQRS_KINDS[form.kind]} ${radicado}`, html: body }),
      resendClient.emails.send({
        from: 'Gorillaz Motorbikes <tienda@gorillazmotorbikes.com>', to: form.email, subject: `Recibimos tu solicitud ${radicado}`,
        html: `<p>Hola ${esc(form.name)}, recibimos tu ${esc(PQRS_KINDS[form.kind].toLowerCase())} con el número <strong>${esc(radicado)}</strong>. Te responderemos a este correo dentro de los 15 días hábiles siguientes.</p>${body}`,
      }),
    ]).catch(() => {});
  }
  res.redirect(303, `/pqrs?radicado=${encodeURIComponent(radicado)}#radicado`);
});

module.exports = router;

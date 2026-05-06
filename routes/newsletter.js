'use strict';
const express = require('express');
const {
  getNewsletterByEmail, getNewsletterByToken, getNewsletterByConfirmToken,
  confirmNewsletterSubscription,
  createNewsletter, deleteNewsletterByToken, deleteNewsletterByEmail,
} = require('../db');
const { verifyRecaptcha } = require('../helpers/recaptcha');
const { RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY, resendClient } = require('../config');

const FROM = 'boletin@gorillazmotorbikes.com';
const BASE_URL = process.env.BASE_URL || 'https://gorillazmotorbikes.com';

router.post('/newsletter', async (req, res) => {
  const express_router = req.app;
  const email     = (req.body.email || '').toString().trim().toLowerCase();
  const isValid   = /.+@.+\..+/.test(email);
  const wantsJSON = (req.headers['x-requested-with'] === 'fetch') || ((req.headers.accept || '').includes('application/json'));
  if (!isValid) {
    if (wantsJSON) return res.status(400).json({ status: 'error', message: 'Correo inválido' });
    return res.redirect('/?flash=error');
  }
  if (RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY) {
    const ok = await verifyRecaptcha(req.body['g-recaptcha-response'], req.ip);
    if (!ok) {
      if (wantsJSON) return res.status(400).json({ status: 'captcha', message: 'Completa el reCAPTCHA' });
      return res.redirect('/?flash=captcha');
    }
  }
  const exist = await getNewsletterByEmail(email);
  if (!exist) {
    const tokens = await createNewsletter(email);
    const confirmLink = `${BASE_URL}/newsletter/confirmar?token=${tokens.confirm_token}`;
    resendClient.emails.send({
      from: FROM,
      to: email,
      subject: 'Confirma tu suscripción al boletín — Gorillaz Motorbikes',
      html: `<p>Hola,</p><p>Gracias por suscribirte al boletín de <strong>Gorillaz Motorbikes</strong>.</p><p>Para completar tu suscripción, haz clic en el siguiente enlace:</p><p><a href="${confirmLink}">Confirmar suscripción</a></p><p>Si no solicitaste esta suscripción, ignora este mensaje.</p>`,
    }).catch(e => console.error('Resend error (newsletter confirm):', e.message));
  }
  if (wantsJSON) return res.json({ status: 'ok' });
  res.redirect('/?flash=ok');
});

router.get('/newsletter/confirmar', async (req, res) => {
  const token = (req.query.token || '').toString().trim();
  if (!token) return res.redirect('/');
  const record = await getNewsletterByConfirmToken(token);
  if (!record) return res.render('newsletter-confirm', { status: 'invalid' });
  await confirmNewsletterSubscription(record.id);
  res.render('newsletter-confirm', { status: 'ok', email: record.email });
});

// Token-based unsubscribe (link desde email)
router.get('/newsletter/desuscribirse', async (req, res) => {
  const token = (req.query.token || '').toString().trim();
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();

  if (token) {
    const record = await getNewsletterByToken(token);
    if (!record) {
      return res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: 'notfound', email: '' });
    }
    await deleteNewsletterByToken(token);
    return res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: 'ok', email: record.email });
  }

  res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: null, email: emailParam });
});

// Form-based unsubscribe (fallback manual)
router.post('/newsletter/desuscribirse', async (req, res) => {
  const email   = (req.body.email || '').toString().trim().toLowerCase();
  const isValid = /.+@.+\..+/.test(email);
  if (!isValid) {
    return res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: 'error', email });
  }
  const exist = await getNewsletterByEmail(email);
  if (!exist) {
    return res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: 'notfound', email });
  }
  await deleteNewsletterByEmail(email);
  res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: 'ok', email });
});

module.exports = router;

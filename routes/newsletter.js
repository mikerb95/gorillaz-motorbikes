'use strict';
const express = require('express');
const { getNewsletterByEmail, createNewsletter, deleteNewsletterByEmail } = require('../db');
const { verifyRecaptcha } = require('../helpers/recaptcha');
const { RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY } = require('../config');

const router = express.Router();

router.post('/newsletter', async (req, res) => {
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
  if (!exist) await createNewsletter(email);
  if (wantsJSON) return res.json({ status: 'ok' });
  res.redirect('/?flash=ok');
});

router.get('/newsletter/desuscribirse', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  res.render('newsletter-unsubscribe', { title: 'Desuscribirse del boletín', status: null, email });
});

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

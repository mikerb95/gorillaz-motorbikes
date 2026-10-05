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
  // Cupón de primera compra (si el dueño lo activó en /admin/tienda/ajustes).
  // Se emite al confirmar el correo, no al suscribirse, para evitar abusos.
  let coupon = null;
  try {
    const { getShopConfig } = require('../helpers/shop/config');
    const { issueFirstPurchaseCoupon } = require('../helpers/shop/coupons');
    coupon = await issueFirstPurchaseCoupon(record.email, getShopConfig().firstPurchaseCoupon);
    if (coupon) {
      const { fmtCOP } = require('../helpers/money');
      const value = coupon.kind === 'amount' ? fmtCOP(coupon.value) : `${coupon.value}%`;
      resendClient.emails.send({
        from: FROM,
        to: record.email,
        subject: 'Tu cupón de bienvenida | Gorillaz Motorbikes',
        html: `<p>Gracias por confirmar tu suscripción. Este es tu cupón para tu primera compra en la tienda:</p><p style="font-size:20px"><strong>${coupon.code}</strong> (${value} de descuento${coupon.minSubtotal ? `, compra mínima ${fmtCOP(coupon.minSubtotal)}` : ''}).</p><p>Úsalo en el checkout con este mismo correo antes del ${new Date(coupon.expiresAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}.</p><p><a href="${BASE_URL}/tienda">Ir a la tienda</a></p>`,
      }).catch(e => console.error('Resend error (cupón):', e.message));
    }
  } catch (e) { console.error('[newsletter] cupón:', e.message); }
  res.render('newsletter-confirm', { status: 'ok', email: record.email, coupon });
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

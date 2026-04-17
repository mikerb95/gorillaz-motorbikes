'use strict';
const { Resend } = require('resend');

if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET not set — using insecure fallback. Set this env var in production.');
}
if (!process.env.BOLD_API_KEY || process.env.BOLD_API_KEY === 'tu_api_key_de_bold_aqui') {
  console.warn('[WARN] BOLD_API_KEY not configured — payments will fail. Set this env var.');
}

const JWT_SECRET          = process.env.JWT_SECRET || 'dev-only-insecure-fallback';
const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY   || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
const resendClient         = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_to_prevent_crash_123');

const BOLD_API_KEY      = process.env.BOLD_API_KEY    || '';
const BOLD_SECRET_KEY   = process.env.BOLD_SECRET_KEY || '';
const BOLD_REDIRECT_URL = process.env.BOLD_REDIRECT_URL || 'http://localhost:3000/payment/return';

module.exports = { JWT_SECRET, RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY, resendClient, BOLD_API_KEY, BOLD_SECRET_KEY, BOLD_REDIRECT_URL };

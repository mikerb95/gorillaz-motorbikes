'use strict';
const { Resend } = require('resend');

if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET not set — using insecure fallback. Set this env var in production.');
}

const JWT_SECRET          = process.env.JWT_SECRET || 'dev-only-insecure-fallback';
const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY   || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
const resendClient         = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_to_prevent_crash_123');

module.exports = { JWT_SECRET, RECAPTCHA_SITE_KEY, RECAPTCHA_SECRET_KEY, resendClient };

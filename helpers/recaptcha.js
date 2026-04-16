'use strict';
const https = require('https');
const { RECAPTCHA_SECRET_KEY } = require('../config');

const verifyRecaptcha = (token, ip) => new Promise((resolve) => {
  if (!RECAPTCHA_SECRET_KEY) return resolve(true);
  const data = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token || '', remoteip: ip || '' }).toString();
  const opts = {
    hostname: 'www.google.com',
    path: '/recaptcha/api/siteverify',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
  };
  const r = https.request(opts, resp => {
    let body = '';
    resp.on('data', d => body += d);
    resp.on('end', () => { try { resolve(!!JSON.parse(body).success); } catch { resolve(false); } });
  });
  r.on('error', () => resolve(false));
  r.write(data); r.end();
});

module.exports = { verifyRecaptcha };

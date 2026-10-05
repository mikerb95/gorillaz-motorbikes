'use strict';
// Parámetros UTM para medir de qué red social llega cada visita.

function withUtm(url, { source, medium = 'social', campaign = '' } = {}) {
  if (!source) return url;
  const u = new URL(url);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', medium);
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

module.exports = { withUtm };

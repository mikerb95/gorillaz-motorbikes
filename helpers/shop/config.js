'use strict';
// Configuración comercial de la tienda, editable en /admin/tienda/ajustes y
// guardada en app_settings('shop_config'). Todo lo que implica un valor del
// negocio (puntos, cupones, banner) arranca apagado hasta que el dueño lo fije.

const settings = require('../settings');

const DEFAULTS = {
  // Puntos del club por compra: 1 punto por cada `pointsPerAmount` COP pagados.
  pointsPerAmount: null,
  // Banner promocional del home y la tienda.
  banner: { enabled: false, text: '', cta: '', href: '', until: '' },
  // "Oferta del mes" del home: id de un producto publicado.
  offerProductId: '',
  // Cupón de primera compra que se entrega al pedir el checklist gratuito.
  firstPurchaseCoupon: { enabled: false, kind: 'pct', value: null, minSubtotal: 0, days: 30 },
  // Agenda de instalación dentro del checkout.
  install: { daysAhead: 30, minLeadDays: 1, serviceName: 'Instalación de accesorios' },
  // Recordatorio de carrito abandonado para usuarios con sesión.
  abandonedCart: { enabled: false, afterHours: 6 },
};

function getShopConfig() {
  const raw = settings.get('shop_config') || {};
  return {
    ...DEFAULTS,
    ...raw,
    banner: { ...DEFAULTS.banner, ...(raw.banner || {}) },
    firstPurchaseCoupon: { ...DEFAULTS.firstPurchaseCoupon, ...(raw.firstPurchaseCoupon || {}) },
    install: { ...DEFAULTS.install, ...(raw.install || {}) },
    abandonedCart: { ...DEFAULTS.abandonedCart, ...(raw.abandonedCart || {}) },
  };
}

async function saveShopConfig(cfg) {
  await settings.set('shop_config', cfg);
}

// Banner vigente (o null). `until` es una fecha AAAA-MM-DD inclusive, en Bogotá.
function activeBanner(cfg = getShopConfig(), now = new Date()) {
  const b = cfg.banner;
  if (!b.enabled || !b.text) return null;
  if (b.until) {
    const today = new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
    if (today > b.until) return null;
  }
  return b;
}

function pointsForPurchase(total, cfg = getShopConfig()) {
  const per = Number(cfg.pointsPerAmount);
  if (!Number.isFinite(per) || per <= 0) return 0;
  return Math.floor(total / per);
}

module.exports = { DEFAULTS, getShopConfig, saveShopConfig, activeBanner, pointsForPurchase };

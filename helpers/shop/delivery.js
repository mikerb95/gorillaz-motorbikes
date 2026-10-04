'use strict';
// Métodos de entrega de la tienda. La configuración vive en
// app_settings('shop_delivery') y la edita el admin. Ningún método ni zona está
// disponible hasta que el dueño defina su tarifa: no se inventan precios.

const settings = require('../settings');

// Localidades de Bogotá (división administrativa oficial). Solo es la lista:
// cobertura y tarifa de cada una las define el dueño.
const BOGOTA_LOCALIDADES = [
  'Usaquén', 'Chapinero', 'Santa Fe', 'San Cristóbal', 'Usme', 'Tunjuelito', 'Bosa', 'Kennedy',
  'Fontibón', 'Engativá', 'Suba', 'Barrios Unidos', 'Teusaquillo', 'Los Mártires', 'Antonio Nariño',
  'Puente Aranda', 'La Candelaria', 'Rafael Uribe Uribe', 'Ciudad Bolívar', 'Sumapaz',
];

const zoneSlug = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const DEFAULTS = {
  pickup: { enabled: true, note: '' },
  local: {
    enabled: false,
    zones: BOGOTA_LOCALIDADES.map((name) => ({ slug: zoneSlug(name), name, fee: null, enabled: false })),
    freeOver: null,
    eta: '',
  },
  national: { enabled: false, fee: null, freeOver: null, eta: '', note: '' },
};

const METHOD_LABELS = {
  pickup: 'Recoger en el taller',
  local: 'Domicilio en Bogotá',
  national: 'Envío nacional',
};

const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// Mezcla lo guardado con los valores por defecto (nuevas zonas, campos nuevos).
function normalize(raw = {}) {
  const local = { ...DEFAULTS.local, ...(raw.local || {}) };
  const saved = new Map((raw.local && Array.isArray(raw.local.zones) ? raw.local.zones : []).map((z) => [z.slug, z]));
  local.zones = DEFAULTS.local.zones.map((z) => ({ ...z, ...(saved.get(z.slug) || {}) }));
  return {
    pickup: { ...DEFAULTS.pickup, ...(raw.pickup || {}) },
    local,
    national: { ...DEFAULTS.national, ...(raw.national || {}) },
  };
}

function getDeliveryConfig() {
  return normalize(settings.get('shop_delivery') || {});
}

// Zonas de domicilio que el cliente puede elegir (activas y con tarifa).
function activeZones(cfg) {
  if (!cfg.local.enabled) return [];
  return cfg.local.zones.filter((z) => z.enabled && isMoney(z.fee));
}

function availableMethods(cfg) {
  const out = [];
  if (cfg.pickup.enabled) out.push('pickup');
  if (activeZones(cfg).length) out.push('local');
  if (cfg.national.enabled && isMoney(cfg.national.fee)) out.push('national');
  return out;
}

// Cotiza la entrega. `merchandise` es el valor de los productos ya con
// descuentos (sobre él se evalúa el envío gratis).
function quoteDelivery(cfg, { method, zone, merchandise = 0 } = {}) {
  if (!method) return { ok: false, error: 'Elige cómo quieres recibir tu pedido.' };
  if (!availableMethods(cfg).includes(method)) return { ok: false, error: 'Ese método de entrega no está disponible.' };
  if (method === 'pickup') return { ok: true, method, fee: 0, label: METHOD_LABELS.pickup };
  if (method === 'local') {
    const z = activeZones(cfg).find((x) => x.slug === zone);
    if (!z) return { ok: false, error: 'Por ahora no llegamos a esa localidad. Puedes recoger en el taller.' };
    const free = isMoney(cfg.local.freeOver) && cfg.local.freeOver > 0 && merchandise >= cfg.local.freeOver;
    return { ok: true, method, zone: z.slug, zoneName: z.name, fee: free ? 0 : z.fee, free, label: `${METHOD_LABELS.local} (${z.name})` };
  }
  const free = isMoney(cfg.national.freeOver) && cfg.national.freeOver > 0 && merchandise >= cfg.national.freeOver;
  return { ok: true, method, fee: free ? 0 : cfg.national.fee, free, label: METHOD_LABELS.national };
}

module.exports = { BOGOTA_LOCALIDADES, DEFAULTS, METHOD_LABELS, normalize, getDeliveryConfig, activeZones, availableMethods, quoteDelivery, zoneSlug };

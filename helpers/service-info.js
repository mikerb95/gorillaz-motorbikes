'use strict';
// Precio "desde" y duración estimada de cada servicio del taller. Los define el
// dueño en /admin/servicios-info (app_settings 'service_info'); mientras no
// estén, la ficha no muestra precio ni duración.

const settings = require('./settings');

function allServiceInfo() {
  const v = settings.get('service_info');
  return v && typeof v === 'object' ? v : {};
}

function getServiceInfo(slug) {
  const i = allServiceInfo()[slug] || {};
  return {
    priceFrom: Number.isFinite(i.priceFrom) && i.priceFrom > 0 ? i.priceFrom : null,
    duration: typeof i.duration === 'string' && i.duration.trim() ? i.duration.trim() : null,
  };
}

async function saveServiceInfo(map) {
  await settings.set('service_info', map);
}

module.exports = { allServiceInfo, getServiceInfo, saveServiceInfo };

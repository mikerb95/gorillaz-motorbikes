'use strict';
const { getAppointmentDates } = require('../db');
// La disponibilidad ahora vive en app_settings (vía helpers/content); aquí solo
// usamos el objeto estable compartido para calcular el mapa de demanda.
const { availability } = require('./content');

async function computeDemandMap() {
  const demand = {};
  let appointments = [];
  try { appointments = await getAppointmentDates(); } catch (e) { console.error('computeDemandMap DB error:', e.message); }
  appointments.forEach(a => {
    if (!a.date) return;
    const d = a.date.slice(0, 10);
    demand[d] = (demand[d] || 0) + 1;
  });
  if (availability && availability.occupationLevels) {
    Object.entries(availability.occupationLevels).forEach(([d, lvl]) => {
      if (lvl === 'high')   demand[d] = Math.max(demand[d] || 0, 8);
      else if (lvl === 'medium') demand[d] = Math.max(demand[d] || 0, 4);
    });
  }
  const result = {};
  Object.entries(demand).forEach(([d, c]) => {
    result[d] = c >= 6 ? 'high' : c >= 3 ? 'medium' : 'low';
  });
  return result;
}

module.exports = { availability, computeDemandMap };

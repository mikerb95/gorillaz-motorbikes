'use strict';
// Fechas y horas para agendar la instalación dentro del checkout. Salen del
// horario único del negocio (helpers/business.js) en hora de Bogotá.

const { WEEK } = require('../business');

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const KEY_BY_INDEX = Object.fromEntries(Object.entries(DAY_INDEX).map(([k, v]) => [v, k]));
const DATE_FMT = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// Horas en punto dentro de cada franja, dejando una hora antes del cierre.
function slotsFor(ranges) {
  const out = [];
  for (const [a, b] of ranges || []) {
    const start = Number(a.slice(0, 2)) + (a.slice(3) === '00' ? 0 : 1);
    const end = Number(b.slice(0, 2)) - 1;
    for (let h = start; h <= end; h++) out.push(`${String(h).padStart(2, '0')}:00`);
  }
  return out;
}

function availableDates(biz, installCfg, now = new Date()) {
  const lead = Math.max(0, Number(installCfg.minLeadDays) || 0);
  const ahead = Math.min(90, Math.max(lead + 1, Number(installCfg.daysAhead) || 30));
  const todayCO = new Date(now.getTime() - 5 * 3600 * 1000);
  const base = Date.UTC(todayCO.getUTCFullYear(), todayCO.getUTCMonth(), todayCO.getUTCDate());
  const out = [];
  for (let i = lead; i <= ahead; i++) {
    const d = new Date(base + i * 86400000);
    const key = KEY_BY_INDEX[d.getUTCDay()];
    const slots = slotsFor(biz.hours[key]);
    if (!slots.length) continue;
    out.push({ date: d.toISOString().slice(0, 10), label: DATE_FMT.format(d), slots });
  }
  return out;
}

function isValidSlot(biz, installCfg, date, time, now = new Date()) {
  const day = availableDates(biz, installCfg, now).find((d) => d.date === date);
  return !!day && (!time || day.slots.includes(time));
}

module.exports = { availableDates, isValidSlot, slotsFor, WEEK };

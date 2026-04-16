'use strict';
const path = require('path');
const fs   = require('fs');
const { getAppointmentDates } = require('../db');

let availability = { blockedDates: [] };
try { availability = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'availability.json'), 'utf8')); } catch { }

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

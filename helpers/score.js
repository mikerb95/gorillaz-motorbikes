'use strict';
const path = require('path');
const fs   = require('fs');
const settings = require('./settings');

const PUNTOS_CONFIG_PATH = path.join(__dirname, '..', 'data', 'puntos-config.json');

const DEFAULTS = {
  points: { rodada: 30, encuentro: 25, caminata: 25, actividad: 25, evento: 25, mantenimiento: 20, visita: 10 },
  levels: [
    { name: 'Gorilla Legend', icon: '🦍', color: '#7c3aed', min: 1500 },
    { name: 'Gorilla',        icon: '🏆', color: '#d97706', min: 700  },
    { name: 'Rider',          icon: '🏍️',  color: '#0891b2', min: 300  },
    { name: 'Miembro',        icon: '✅',  color: '#16a34a', min: 100  },
    { name: 'Prospecto',      icon: '🌱',  color: '#6b7280', min: 0    },
  ],
};

// Lee de la caché de app_settings (clave 'puntos'); si aún no está en BD, cae
// al archivo JSON committeado y, en último caso, a los DEFAULTS.
function loadPuntosConfig() {
  let raw = settings.get('puntos');
  if (raw === undefined) {
    try { raw = JSON.parse(fs.readFileSync(PUNTOS_CONFIG_PATH, 'utf8')); }
    catch { raw = {}; }
  }
  return {
    points: { ...DEFAULTS.points, ...(raw.points || {}) },
    levels: (Array.isArray(raw.levels) && raw.levels.length) ? raw.levels : DEFAULTS.levels,
  };
}

// Proxy so any code that destructures SCORE_POINTS gets live values per-read
const SCORE_POINTS = new Proxy({}, {
  get(_, key) { return loadPuntosConfig().points[key]; },
  ownKeys()   { return Object.keys(loadPuntosConfig().points); },
  has(_, key) { return key in loadPuntosConfig().points; },
  getOwnPropertyDescriptor(_, key) {
    const val = loadPuntosConfig().points[key];
    return val !== undefined ? { value: val, writable: true, enumerable: true, configurable: true } : undefined;
  },
});

function getScoreLevel(score) {
  const levels = [...loadPuntosConfig().levels].sort((a, b) => b.min - a.min);
  for (const lvl of levels) {
    if (score >= lvl.min) return { name: lvl.name, icon: lvl.icon, color: lvl.color };
  }
  return levels[levels.length - 1];
}

module.exports = { SCORE_POINTS, getScoreLevel, loadPuntosConfig, DEFAULTS };

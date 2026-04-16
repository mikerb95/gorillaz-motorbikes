'use strict';

const SCORE_POINTS = {
  rodada:        30,
  evento:        25,
  mantenimiento: 20,
  visita:        10,
};

function getScoreLevel(score) {
  if (score >= 1500) return { name: 'Gorilla Legend', icon: '🦍', color: '#7c3aed' };
  if (score >= 700)  return { name: 'Gorilla',        icon: '🏆', color: '#d97706' };
  if (score >= 300)  return { name: 'Rider',          icon: '🏍️',  color: '#0891b2' };
  if (score >= 100)  return { name: 'Miembro',        icon: '✅',  color: '#16a34a' };
  return                    { name: 'Prospecto',      icon: '🌱',  color: '#6b7280' };
}

module.exports = { SCORE_POINTS, getScoreLevel };

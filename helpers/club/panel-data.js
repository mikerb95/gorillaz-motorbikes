'use strict';
// Arma todo lo que necesita el panel del miembro (/club/panel) a partir de los
// datos reales: niveles configurados, órdenes del taller por placa, asistencias
// confirmadas e historial de puntos. La lógica pura vive en ./lib.js.

const {
  getUpcomingEvents, getUserEventRegistrations, getQuotationsByMotorcyclePlates,
  getUserRank, getPasskeysByUserId, getServiceOrdersByPlate, getUserAttendanceCounts,
  ensureMemberCode, getLeaderboardAround,
} = require('../../db');
const { loadPuntosConfig } = require('../score');
const { hoyCO } = require('../datetime');
const lib = require('./lib');

const ORDER_STATUS = {
  pendiente:        'Recibida',
  ingreso_taller:   'Ingresó al taller',
  trabajo_en_curso: 'Trabajo en curso',
  en_pausa:         'En pausa',
  trabajo_completo: 'Trabajo completo',
  facturado:        'Lista para entregar',
  entregado:        'Entregada',
};

async function settle(promise, fallback) {
  try { return await promise; } catch (e) { console.error('panel club:', e.message); return fallback; }
}

async function buildPanelData(user) {
  const today  = hoyCO();
  const puntos = loadPuntosConfig();
  const progress = lib.levelProgress(user.score || 0, puntos.levels);

  const vehicles = (user.vehicles || []).map(v => {
    const soat  = v.soatExpires  ? lib.daysUntil(v.soatExpires, today)  : null;
    const tecno = v.tecnoExpires ? lib.daysUntil(v.tecnoExpires, today) : null;
    return {
      ...v,
      soat:  { days: soat,  state: lib.docState(soat),  label: lib.docLabel(soat),  date: v.soatExpires || null },
      tecno: { days: tecno, state: lib.docState(tecno), label: lib.docLabel(tecno), date: v.tecnoExpires || null },
      orders: [],
    };
  });
  const plates = vehicles.map(v => v.plate).filter(Boolean);

  const [upcomingEvents, registrations, quotations, rank, passkeys, attendance, memberCode, neighbors, ordersByPlate] = await Promise.all([
    settle(getUpcomingEvents(8), []),
    settle(getUserEventRegistrations(user.id), {}),
    settle(getQuotationsByMotorcyclePlates(plates), []),
    settle(getUserRank(user.id, user.score || 0), null),
    settle(getPasskeysByUserId(user.id), []),
    settle(getUserAttendanceCounts(user.id), {}),
    settle(ensureMemberCode(user), null),
    settle(getLeaderboardAround(user.id, user.score || 0), { above: [], below: [] }),
    Promise.all(plates.map(p => settle(getServiceOrdersByPlate(p), []))),
  ]);

  // La búsqueda por placa es por LIKE sobre el campo combinado: se filtra por
  // placa exacta para no mezclar ABC12 con ABC123.
  vehicles.forEach((v, i) => {
    v.orders = (ordersByPlate[i] || [])
      .filter(o => lib.plateFromOrder(o.motorcycle) === String(v.plate).toUpperCase())
      .map(o => ({ ...o, model: lib.modelFromOrder(o.motorcycle), statusLabel: ORDER_STATUS[o.status] || o.status }));
    v.model = v.model || (v.orders.find(o => o.model) || {}).model || '';
  });

  const history = user.scoreHistory || [];
  const streak = lib.monthlyStreak(history, today);
  const challenge = lib.monthlyChallenge(history, today);

  const delivered = vehicles.reduce((n, v) => n + v.orders.filter(o => o.status === 'entregado').length, 0);
  const legacyServices = (user.visits || []).filter(x => x && x.type === 'mantenimiento' && x.status !== 'pending').length;
  const rodadas = attendance.rodada || 0;
  const encuentros = Object.entries(attendance).filter(([t]) => t !== 'rodada').reduce((n, [, c]) => n + c, 0);
  const badges = lib.computeBadges({
    rodadas,
    encuentros,
    servicios: delivered + legacyServices,
    docsOk: vehicles.some(v => ['ok', 'soon'].includes(v.soat.state) && ['ok', 'soon'].includes(v.tecno.state)) ? 1 : 0,
    profileReady: user.bloodType && user.emergencyName && user.emergencyPhone ? 1 : 0,
    daysInClub: lib.daysSince(user.membership && user.membership.since ? user.membership.since : String(user.createdAt || '').slice(0, 10), today),
    streak: streak.months,
  });

  // Alertas: solo lo que pide una acción, ordenado por urgencia.
  const alerts = [];
  vehicles.forEach(v => {
    v.orders.filter(o => !['entregado', 'anulada', 'cancelada'].includes(o.status)).slice(0, 1).forEach(o => {
      alerts.push({ kind: 'order', tone: o.status === 'facturado' ? 'ok' : 'info', plate: v.plate, title: `Tu moto ${v.plate}: ${o.statusLabel}`, order: o });
    });
    [['soat', 'SOAT'], ['tecno', 'Tecnomecánica']].forEach(([k, name]) => {
      const d = v[k];
      if (d.state === 'expired' || d.state === 'soon') {
        alerts.push({ kind: k, tone: d.state === 'expired' ? 'danger' : 'warn', plate: v.plate, title: `${name} de ${v.plate}: ${d.label.toLowerCase()}`, days: d.days });
      }
    });
  });
  const toneRank = { danger: 0, warn: 1, ok: 2, info: 3 };
  alerts.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  const nextEvent = upcomingEvents.find(ev => registrations[ev.id] !== 'confirmed') || null;

  return {
    today, puntos, progress, vehicles, upcomingEvents, registrations, nextEvent,
    quotations, rank, passkeys, memberCode, neighbors, history, streak, challenge, badges,
    earnedCount: badges.filter(b => b.earned).length, alerts,
    activity: { rodadas, encuentros, servicios: delivered + legacyServices },
  };
}

module.exports = { buildPanelData, ORDER_STATUS };

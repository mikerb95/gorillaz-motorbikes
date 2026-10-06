'use strict';
// Lógica pura del club (sin BD ni Express): progreso de nivel, estado de los
// documentos, racha mensual, reto del mes e insignias. Todo se deriva de datos
// que ya existen (puntos, historial, asistencias confirmadas, órdenes
// entregadas), así que nada de lo que muestra el panel es inventado.
// Tests: test/club/club-lib.test.mjs

// Separador del campo combinado de las órdenes: "PLACA <raya> modelo".
const DASH = String.fromCharCode(0x2014);

// ── Niveles ──────────────────────────────────────────────────────────────────

function sortLevels(levels) {
  return [...(levels || [])]
    .map(l => ({ ...l, min: Math.max(0, Number(l.min) || 0), benefits: Array.isArray(l.benefits) ? l.benefits.filter(Boolean) : [] }))
    .sort((a, b) => a.min - b.min);
}

// Nivel actual, siguiente y cuánto falta. Usa los niveles configurados en el
// admin (antes el panel tenía los umbrales fijos en la vista y se desfasaba).
function levelProgress(score, levels) {
  const sorted = sortLevels(levels);
  const sc = Math.max(0, Number(score) || 0);
  let idx = 0;
  sorted.forEach((l, i) => { if (sc >= l.min) idx = i; });
  const current = sorted[idx] || null;
  const next = sorted[idx + 1] || null;
  const span = next ? next.min - current.min : 0;
  const pct = next ? Math.min(100, Math.max(0, Math.round(((sc - current.min) / span) * 100))) : 100;
  return {
    levels: sorted,
    index: idx,
    current,
    next,
    pct,
    remaining: next ? next.min - sc : 0,
  };
}

// ── Documentos (SOAT / tecnomecánica) ────────────────────────────────────────

// days: días que faltan (negativo = vencido), null = sin fecha.
function docState(days) {
  if (days === null || days === undefined) return 'none';
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}

function docLabel(days) {
  if (days === null || days === undefined) return 'Sin fecha';
  if (days < 0) return `Vencido hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}

// ── Placa dentro del campo combinado de las órdenes ─────────────────────────

function plateFromOrder(motorcycle) {
  return String(motorcycle || '').split(` ${DASH} `)[0].toUpperCase().replace(/\s/g, '');
}

function modelFromOrder(motorcycle) {
  return String(motorcycle || '').split(` ${DASH} `).slice(1).join(` ${DASH} `).trim();
}

// ── Actividad por mes (desde el historial de puntos) ─────────────────────────

const monthKey = (ymd) => String(ymd || '').slice(0, 7); // 'YYYY-MM'

function prevMonth(key) {
  let [y, m] = key.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Meses seguidos con al menos una actividad que sumó puntos. Si el mes en curso
// aún no tiene actividad, la racha se cuenta desde el mes anterior: no se
// "rompe" el día 1 de cada mes (rachas mensuales, no diarias, y con margen).
function monthlyStreak(history, today) {
  const active = new Set((history || []).filter(h => Number(h.points) > 0).map(h => monthKey(h.date)));
  let key = monthKey(today);
  const currentActive = active.has(key);
  if (!currentActive) key = prevMonth(key);
  let n = 0;
  while (active.has(key)) { n++; key = prevMonth(key); }
  return { months: n, currentActive };
}

// ── Reto del mes ─────────────────────────────────────────────────────────────
// Rota solo según el mes; el progreso sale de las actividades del mes en curso.

const CHALLENGES = [
  { id: 'rodar',     title: 'Sal a rodar',        desc: 'Asiste a una rodada del club este mes.',              concepts: ['rodada'], goal: 1 },
  { id: 'taller',    title: 'Pasa por el taller', desc: 'Haz una visita o un servicio en el taller este mes.', concepts: ['visita', 'mantenimiento'], goal: 1 },
  { id: 'doble',     title: 'Doble actividad',    desc: 'Suma puntos en dos actividades este mes.',            concepts: null, goal: 2 },
  { id: 'encuentro', title: 'Únete a la manada',  desc: 'Asiste a un encuentro, caminata o actividad del club este mes.', concepts: ['encuentro', 'caminata', 'actividad', 'evento'], goal: 1 },
];

function monthlyChallenge(history, today) {
  const key = monthKey(today);
  const month = Number(key.slice(5, 7)) || 1;
  const ch = CHALLENGES[(month - 1) % CHALLENGES.length];
  const value = (history || []).filter(h =>
    Number(h.points) > 0 && monthKey(h.date) === key && (!ch.concepts || ch.concepts.includes(h.concept))
  ).length;
  // Días que quedan del mes (incluido hoy), para dar sensación de cierre.
  const [y, m, d] = String(today).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ...ch, value: Math.min(value, ch.goal), done: value >= ch.goal, daysLeft: lastDay - d + 1 };
}

// ── Insignias ────────────────────────────────────────────────────────────────
// stats: { rodadas, encuentros, servicios, docsOk, profileReady, daysInClub, streak }

const BADGES = [
  { id: 'primera-rodada',  icon: 'route',    name: 'Primera rodada',       desc: 'Asiste a tu primera rodada del club.',                stat: 'rodadas',      goal: 1 },
  { id: 'rodador',         icon: 'route',    name: 'Rodador',              desc: 'Completa 5 rodadas con el club.',                     stat: 'rodadas',      goal: 5 },
  { id: 'manada',          icon: 'users',    name: 'De la manada',         desc: 'Completa 15 rodadas con el club.',                    stat: 'rodadas',      goal: 15 },
  { id: 'social',          icon: 'flag',     name: 'Buena compañía',       desc: 'Asiste a 3 encuentros o actividades del club.',       stat: 'encuentros',   goal: 3 },
  { id: 'primer-servicio', icon: 'wrench',   name: 'Primer servicio',      desc: 'Entrega tu moto al taller por primera vez.',          stat: 'servicios',    goal: 1 },
  { id: 'cliente-fiel',    icon: 'wrench',   name: 'Cliente de casa',      desc: 'Completa 5 servicios en el taller.',                  stat: 'servicios',    goal: 5 },
  { id: 'garaje',          icon: 'bike',     name: 'Garaje al día',        desc: 'Registra tu moto con SOAT y tecnomecánica vigentes.', stat: 'docsOk',       goal: 1 },
  { id: 'listo',           icon: 'heart',    name: 'Listo para rodar',     desc: 'Completa tu RH y tu contacto de emergencia.',         stat: 'profileReady', goal: 1 },
  { id: 'racha-3',         icon: 'flame',    name: 'Constante',            desc: 'Mantente activo 3 meses seguidos.',                   stat: 'streak',       goal: 3 },
  { id: 'racha-6',         icon: 'flame',    name: 'Imparable',            desc: 'Mantente activo 6 meses seguidos.',                   stat: 'streak',       goal: 6 },
  { id: 'aniversario-1',   icon: 'calendar', name: 'Un año en el club',    desc: 'Cumple un año como miembro.',                         stat: 'daysInClub',   goal: 365 },
  { id: 'aniversario-3',   icon: 'calendar', name: 'Tres años en el club', desc: 'Cumple tres años como miembro.',                      stat: 'daysInClub',   goal: 365 * 3 },
];

function computeBadges(stats) {
  return BADGES.map(b => {
    const value = Math.max(0, Number(stats && stats[b.stat]) || 0);
    return { ...b, value: Math.min(value, b.goal), earned: value >= b.goal };
  });
}

// Días entre una fecha 'YYYY-MM-DD' y hoy (ambas «solo día», sin zona horaria).
function daysSince(ymd, today) {
  const a = Date.parse(String(ymd || '').slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(today || '').slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

// ── Código de miembro (credencial) ──────────────────────────────────────────
// Sin caracteres ambiguos (0/O, 1/I/L) para poder dictarlo o teclearlo.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function newMemberCode(randomBytes) {
  const bytes = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return 'GZ' + s;
}

function isMemberCode(code) {
  return new RegExp(`^GZ[${CODE_ALPHABET}]{6}$`).test(String(code || ''));
}

module.exports = {
  sortLevels, levelProgress, docState, docLabel, plateFromOrder, modelFromOrder,
  monthlyStreak, monthlyChallenge, CHALLENGES, computeBadges, BADGES, daysSince,
  newMemberCode, isMemberCode, CODE_ALPHABET,
};

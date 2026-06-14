'use strict';

// ── Hora Colombia (America/Bogota, UTC−5, sin horario de verano) ────────────
//
// Toda la base de datos guarda los timestamps en UTC (sufijo `Z`). Para mostrar
// las horas al usuario se convierten a hora Colombia AQUÍ, en la capa de
// visualización. Así los registros existentes no se modifican: simplemente se
// renderizan −5h. Los registros nuevos también se guardan en UTC y se muestran
// igual, manteniendo todo consistente.
//
// Colombia no observa horario de verano, por lo que America/Bogota === UTC−5
// siempre (equivale al «cálculo de −5 horas»).

const TZ = 'America/Bogota';

// ¿Es una fecha «solo día» tipo "2026-06-13" (sin componente de hora)?
function isDateOnly(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// Normaliza cualquier valor a un objeto Date. Las fechas «solo día» se anclan a
// mediodía UTC para que el desfase a hora Colombia (−5h) nunca cruce la
// medianoche y cambie el día calendario (un egreso del 13 debe mostrarse 13).
function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (isDateOnly(value)) return new Date(value.trim() + 'T12:00:00Z');
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const DEFAULT_DATE = { day: '2-digit', month: 'short', year: 'numeric' };
const DEFAULT_TIME = { hour: '2-digit', minute: '2-digit' };

// Fecha en hora Colombia. Acepta timestamps UTC (los convierte −5h) y fechas
// «solo día» (las muestra tal cual, sin desfase de día).
function fechaCO(value, opts = DEFAULT_DATE) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('es-CO', { timeZone: TZ, ...opts });
}

// Hora del día en hora Colombia.
function horaCO(value, opts = DEFAULT_TIME) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleTimeString('es-CO', { timeZone: TZ, ...opts });
}

// Fecha + hora en hora Colombia.
function fechaHoraCO(value, opts = { ...DEFAULT_DATE, ...DEFAULT_TIME }) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('es-CO', { timeZone: TZ, ...opts });
}

// «Hoy» en hora Colombia como YYYY-MM-DD, para guardar registros «solo día»
// (membresía, historial de puntos…) con el día correcto en Colombia.
function hoyCO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

module.exports = { TZ, isDateOnly, toDate, fechaCO, horaCO, fechaHoraCO, hoyCO };

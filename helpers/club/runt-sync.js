'use strict';
// Mantiene al día el SOAT y la tecnomecánica de las motos del garaje usando el
// proveedor de datos del RUNT (helpers/runt-provider.js). El miembro nunca
// escribe fechas: se consultan al agregar la moto y se vuelven a consultar
// solas cuando algo está por vencer, para enterarse de la renovación.
//
// Cada consulta cuesta, así que solo se repite cuando hace falta (needsRefresh).
// Estado en el vehículo:
//   runtStatus    'ok' | 'notfound' | 'error' | 'nodoc'
//   runtCheckedAt ISO de la última consulta
//   runtDoc       documento con el que se consultó (si cambia, se reconsulta)
//   ownerDoc      cédula del propietario, si la moto no está a nombre del miembro

const { db, getUserById, updateUser } = require('../../db');
const { consultarVehiculo, providerName } = require('../runt-provider');
const { hoyCO } = require('../datetime');
const { daysUntil } = require('./lib');

const MAX_PER_RUN = 40; // tope de consultas pagas por corrida del cron

const docFor = (v, user) => String(v.ownerDoc || (user && user.cedula) || '').replace(/\D/g, '');
const hoursSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 3600000 : Infinity);

// ¿Vale la pena gastar una consulta en esta moto hoy?
function needsRefresh(v, user, now = Date.now(), today = hoyCO()) {
  const doc = docFor(v, user);
  if (!doc) return false;
  if (!v.runtCheckedAt || v.runtDoc !== doc) return true;
  const age = hoursSince(v.runtCheckedAt, now) / 24;
  if (v.runtStatus === 'notfound') return false; // mismo documento, mismo resultado
  if (v.runtStatus === 'error') return age >= 1;
  const days = [v.soatExpires, v.tecnoExpires].filter(Boolean).map(d => daysUntil(d, today));
  const nearest = days.length ? Math.min(...days) : null;
  // Vence hoy o venció hace poco: a diario, para no avisar "vencido" a quien
  // ya renovó. Por vencer o vencido hace rato: cada 3 días.
  if (nearest !== null && nearest <= 0 && nearest >= -7) return age >= 0.9;
  if (nearest !== null && nearest <= 7 && nearest >= -60) return age >= 3;
  // Vencido hace mucho, o el RUNT no trae alguno de los dos: mensual.
  if (nearest !== null && nearest < -60) return age >= 30;
  if (days.length < 2) return age >= 30;
  // Todo vigente: un repaso cada seis meses (cambio de dueño, correcciones).
  return age >= 180;
}

// Consulta una moto y guarda el resultado. Devuelve el vehículo actualizado.
async function syncVehicle(userId, plate, now = Date.now()) {
  const user = await getUserById(userId);
  const v = user && (user.vehicles || []).find(x => x.plate === plate);
  if (!v) return null;
  const doc = docFor(v, user);
  const patch = { runtCheckedAt: new Date(now).toISOString(), runtDoc: doc };
  if (!doc) {
    Object.assign(patch, { runtStatus: 'nodoc' });
  } else {
    const r = await consultarVehiculo({ plate, docNumber: doc });
    patch.runtStatus = r.status;
    if (r.status === 'ok') {
      // Lo que el RUNT no trae queda vacío: una fecha vieja daría avisos falsos.
      patch.soatExpires = r.soat || '';
      patch.tecnoExpires = r.tecno || '';
    } else {
      console.error(`[runt] ${plate}: ${r.status} ${r.reason || ''}`);
    }
  }
  // Se relee: la consulta tarda y el miembro pudo tocar el garaje mientras tanto.
  const fresh = await getUserById(userId);
  let updated = null;
  const vehicles = (fresh.vehicles || []).map(x => {
    if (x.plate !== plate) return x;
    updated = { ...x, ...patch };
    return updated;
  });
  if (updated) await updateUser(userId, { vehicles });
  return updated;
}

// Cron: consulta las motos que lo necesitan, hasta MAX_PER_RUN por corrida.
async function refreshDueVehicles({ now = Date.now(), today = hoyCO(), limit = MAX_PER_RUN } = {}) {
  if (!providerName()) return 0;
  const r = await db.execute(`SELECT id FROM users WHERE deleted_at IS NULL AND vehicles LIKE '%"plate"%'`);
  const due = [];
  for (const { id } of r.rows) {
    if (due.length >= limit) break;
    const user = await getUserById(id);
    for (const v of (user && user.vehicles) || []) {
      if (v.plate && needsRefresh(v, user, now, today)) due.push([id, v.plate]);
      if (due.length >= limit) break;
    }
  }
  // Las motos de un mismo usuario van en serie (comparten el JSON `vehicles`
  // y en paralelo se pisarían); usuarios distintos, de a 4 a la vez.
  const byUser = new Map();
  due.forEach(([id, plate]) => byUser.set(id, [...(byUser.get(id) || []), plate]));
  const users = [...byUser.entries()];
  let done = 0;
  for (let i = 0; i < users.length; i += 4) {
    const batch = await Promise.allSettled(users.slice(i, i + 4).map(([id, plates]) => syncPlates(id, plates, now)));
    batch.forEach(b => { if (b.status === 'fulfilled') done += b.value; });
  }
  return done;
}

async function syncPlates(userId, plates, now) {
  let n = 0;
  for (const plate of plates) if (await syncVehicle(userId, plate, now).catch(() => null)) n++;
  return n;
}

// Sincroniza en el momento (registro, agregar moto) sin colgar la respuesta:
// si el proveedor tarda más de `ms`, lo que falte lo termina el cron.
async function syncSoon(userId, plates, ms = 8000) {
  if (!providerName() || !plates.length) return;
  const work = syncPlates(userId, plates, Date.now());
  await Promise.race([work, new Promise(r => setTimeout(r, ms))]);
}

module.exports = { needsRefresh, syncVehicle, refreshDueVehicles, syncSoon, docFor };

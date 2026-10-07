'use strict';
// Avisos por correo del vencimiento del SOAT y la tecnomecánica de las motos
// del garaje. Corre desde el cron diario (routes/cron.js), que ya existe: así
// no se gasta otro cron de Vercel.
//
// Cada documento avisa una vez por escalón (30 días, 7 días, el día que vence).
// Lo ya avisado queda en el vehículo como `reminded: { soat: 'AAAA-MM-DD@7' }`:
// la fecha va en la marca, así que al renovar (fecha nueva) los avisos vuelven
// a empezar solos. Si el cron se salta un día, el siguiente manda el escalón
// que corresponda sin repetir los anteriores.

const { db, getUserById, updateUser } = require('../../db');
const { resendClient } = require('../../config');
const { esc, mailEnabled } = require('../shop/emails');
const { abs } = require('../seo');
const { hoyCO } = require('../datetime');
const { daysUntil } = require('./lib');

const FROM = 'Club Gorillaz <booking@gorillazmotorbikes.com>';
const STEPS = [30, 7, 0];
// Un documento vencido hace más de esto ya no se avisa: evita que la primera
// corrida le escriba a todo el que tiene fechas viejas en el garaje.
const MAX_OVERDUE_DAYS = 3;
const DOCS = [['soat', 'soatExpires', 'SOAT'], ['tecno', 'tecnoExpires', 'Tecnomecánica']];

// Escalón que toca hoy (el más pequeño que ya se alcanzó), o null si no toca.
function stepFor(days) {
  if (days === null || days > STEPS[0] || days < -MAX_OVERDUE_DAYS) return null;
  return STEPS.filter(s => days <= s).pop();
}

function alreadySent(mark, date, step) {
  if (!mark) return false;
  const [d, s] = String(mark).split('@');
  return d === date && Number(s) <= step;
}

// Documentos de un usuario que hay que avisar hoy, con la marca nueva.
function dueDocs(vehicles, today) {
  const due = [];
  (vehicles || []).forEach((v, i) => {
    DOCS.forEach(([key, field, name]) => {
      const date = String(v[field] || '').slice(0, 10);
      if (!date) return;
      const days = daysUntil(date, today);
      const step = stepFor(days);
      if (step === null || alreadySent(v.reminded && v.reminded[key], date, step)) return;
      due.push({ index: i, key, name, plate: v.plate, date, days, mark: `${date}@${step}` });
    });
  });
  return due;
}

function whenLabel(days) {
  if (days < 0) return `venció hace ${-days} ${days === -1 ? 'día' : 'días'}`;
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

async function sendDocsEmail(user, docs) {
  const rows = docs.map(d => `<li><strong>${esc(d.name)}</strong> de la moto <strong>${esc(d.plate)}</strong>: ${esc(whenLabel(d.days))} (${esc(d.date)})</li>`).join('');
  const tecno = docs.some(d => d.key === 'tecno')
    ? `<p>¿Te toca la tecnomecánica? En el taller te alistamos la moto antes de ir al CDA para llegar al CDA sin sorpresas: gases, frenos, luces, llantas y nivel sonoro.</p>
       <p><a href="${esc(abs('/servicios/alistamiento-tecnomecanica'))}" style="background:#F25C05;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver el alistamiento</a></p>`
    : '';
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#F25C05">${esc(user.firstName || user.name || 'Hola')}, revisa los papeles de tu moto</h2>
      <ul>${rows}</ul>
      ${tecno}
      <p>Cuando renueves, actualiza la fecha en tu garaje (o tráela del RUNT con un clic) y dejamos de avisarte por este documento.</p>
      <p><a href="${esc(abs('/club/panel#garaje'))}">Ir a mi garaje</a></p>
      <p style="color:#888;font-size:13px">Recibes este correo porque tienes activas las notificaciones del club. Puedes apagarlas en tu panel, pestaña Cuenta.</p>
    </div>`;
  const soon = docs.reduce((m, d) => Math.min(m, d.days), Infinity);
  const subject = soon <= 0 ? 'Tienes un documento de la moto vencido' : 'Se acerca el vencimiento de un documento de tu moto';
  await resendClient.emails.send({ from: FROM, to: user.email, subject, html });
  return true;
}

async function remindExpiringDocs(today = hoyCO()) {
  if (!mailEnabled()) return 0;
  // Filtro grueso en SQL (alguien con alguna fecha); el fino va en dueDocs.
  const r = await db.execute(`SELECT id FROM users
    WHERE deleted_at IS NULL AND club_notifications != 0 AND email IS NOT NULL
      AND vehicles LIKE '%Expires":"2%'`);
  let sent = 0;
  for (const { id } of r.rows) {
    const user = await getUserById(id);
    if (!user || !user.email || user.clubNotifications === false) continue;
    const docs = dueDocs(user.vehicles, today);
    if (!docs.length) continue;
    // Se marca primero: aunque falle el envío, nunca se repite el correo.
    const vehicles = user.vehicles.map(v => ({ ...v, reminded: { ...(v.reminded || {}) } }));
    docs.forEach(d => { vehicles[d.index].reminded[d.key] = d.mark; });
    await updateUser(user.id, { vehicles });
    if (await sendDocsEmail(user, docs).catch((e) => { console.error('[cron] aviso documentos:', e.message); return false; })) sent++;
  }
  return sent;
}

module.exports = { remindExpiringDocs, dueDocs, stepFor };

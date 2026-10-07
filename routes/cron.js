'use strict';
// Tareas diarias (cron de Vercel, ver vercel.json). El plan gratis no da más
// crons, así que todo lo diario cuelga de esta misma ruta:
//   - libera el stock reservado por pedidos que no se pagaron;
//   - envía UN recordatorio de carrito abandonado a usuarios con sesión;
//   - avisa del vencimiento del SOAT y la tecnomecánica (garaje del club).
// Protegido con CRON_SECRET (Vercel lo envía como "Authorization: Bearer …").

const express = require('express');
const { db, getUserById } = require('../db');
const { releaseExpired } = require('../helpers/shop/orders');
const { getShopConfig } = require('../helpers/shop/config');
const { priceCart } = require('../helpers/cart');
const { sendCartReminder } = require('../helpers/shop/emails');
const { refreshIfStale } = require('../helpers/catalog');
const { remindExpiringDocs } = require('../helpers/club/doc-reminders');

const router = express.Router();

async function remindAbandonedCarts(now = Date.now()) {
  const cfg = getShopConfig().abandonedCart;
  if (!cfg.enabled) return 0;
  const cutoff = new Date(now - cfg.afterHours * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const oldest = new Date(now - 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r = await db.execute({
    sql: 'SELECT user_id, items FROM saved_carts WHERE reminded_at IS NULL AND updated_at < ? AND updated_at > ? LIMIT 50',
    args: [cutoff, oldest],
  });
  let sent = 0;
  for (const row of r.rows) {
    // Se marca primero: aunque falle el envío, nunca se repite el correo.
    const claim = await db.execute({
      sql: "UPDATE saved_carts SET reminded_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id = ? AND reminded_at IS NULL",
      args: [row.user_id],
    });
    if (!(claim.rowsAffected ?? claim.changes)) continue;
    const user = await getUserById(row.user_id);
    if (!user || !user.email || user.clubNotifications === false) continue;
    let cart;
    try { cart = JSON.parse(row.items); } catch { continue; }
    const priced = priceCart(cart, { user });
    if (!priced.count) continue;
    if (await sendCartReminder({ email: user.email, name: user.firstName || user.name, lines: priced.lines, total: priced.merchandise }).catch(() => false)) sent++;
  }
  return sent;
}

router.get('/api/cron/tienda', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  await refreshIfStale(0);
  const released = await releaseExpired().catch((e) => { console.error('[cron] reservas:', e.message); return -1; });
  const reminders = await remindAbandonedCarts().catch((e) => { console.error('[cron] carritos:', e.message); return -1; });
  const docs = await remindExpiringDocs().catch((e) => { console.error('[cron] documentos:', e.message); return -1; });
  res.json({ ok: true, released, reminders, docs });
});

module.exports = router;
module.exports.remindAbandonedCarts = remindAbandonedCarts;

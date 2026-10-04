'use strict';
// Reseñas dentro del sitio (tabla reviews, v19). Solo compradores verificados:
//   - producto: código de pedido PAGADO + correo de ese pedido, y el pedido
//     debe contener el producto;
//   - servicio: placa + últimos 4 dígitos del teléfono de una orden de taller
//     ENTREGADA.
// Toda reseña entra 'pendiente' y solo se publica tras moderación.

const { v4: uuidv4 } = require('uuid');
const { db, getOrderByPublicCode, getServiceOrdersByPlate } = require('../../db');

function rowToReview(r) {
  return {
    id: r.id, kind: r.kind, target: r.target, orderId: r.order_id || null, serviceOrderId: r.service_order_id || null,
    authorName: r.author_name, rating: Number(r.rating) || 0, body: r.body || '', status: r.status,
    createdAt: r.created_at, moderatedAt: r.moderated_at || null,
  };
}

async function approvedSummary(kind, target, limit = 10) {
  const [agg, items] = await db.batch([
    { sql: "SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE kind = ? AND target = ? AND status = 'aprobada'", args: [kind, target] },
    { sql: "SELECT * FROM reviews WHERE kind = ? AND target = ? AND status = 'aprobada' ORDER BY created_at DESC LIMIT ?", args: [kind, target, limit] },
  ], 'read');
  const count = Number(agg.rows[0].n) || 0;
  return {
    count,
    average: count ? Math.round(Number(agg.rows[0].avg) * 10) / 10 : 0,
    items: items.rows.map(rowToReview),
  };
}

const last4 = (phone) => String(phone || '').replace(/\D/g, '').slice(-4);

async function verifyProductPurchase({ productId, orderCode, email }) {
  const order = await getOrderByPublicCode(String(orderCode || '').trim().toUpperCase());
  if (!order || order.status !== 'paid') return null;
  if (String(order.customerEmail || '').toLowerCase() !== String(email || '').trim().toLowerCase()) return null;
  if (!order.items.some((i) => (i.productId || i.id) === productId)) return null;
  return order;
}

async function verifyServiceVisit({ plate, phone4 }) {
  const clean = String(plate || '').trim().toUpperCase().replace(/\s/g, '');
  if (clean.length < 3 || !/^\d{4}$/.test(String(phone4 || ''))) return null;
  const orders = await getServiceOrdersByPlate(clean);
  return orders.find((o) => (o.deliveredAt || o.status === 'entregado') && last4(o.clientPhone) === String(phone4)) || null;
}

async function alreadyReviewed({ kind, target, orderId, serviceOrderId }) {
  const r = await db.execute({
    sql: 'SELECT id FROM reviews WHERE kind = ? AND target = ? AND (order_id = ? OR service_order_id = ?)',
    args: [kind, target, orderId || '', serviceOrderId || ''],
  });
  return r.rows.length > 0;
}

async function createReview({ kind, target, orderId = null, serviceOrderId = null, userId = null, authorName, rating, body }) {
  const id = uuidv4();
  await db.execute({
    sql: `INSERT INTO reviews (id, kind, target, order_id, service_order_id, user_id, author_name, rating, body)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, kind, target, orderId, serviceOrderId, userId, String(authorName).slice(0, 60),
      Math.min(5, Math.max(1, parseInt(rating, 10) || 0)), String(body || '').slice(0, 1500)],
  });
  return id;
}

async function listReviews(status = 'pendiente', limit = 100) {
  const r = await db.execute({ sql: 'SELECT * FROM reviews WHERE status = ? ORDER BY created_at DESC LIMIT ?', args: [status, limit] });
  return r.rows.map(rowToReview);
}

async function moderateReview(id, status) {
  if (!['aprobada', 'rechazada', 'pendiente'].includes(status)) return;
  await db.execute({
    sql: "UPDATE reviews SET status = ?, moderated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
    args: [status, id],
  });
}

async function countPendingReviews() {
  const r = await db.execute("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pendiente'");
  return Number(r.rows[0].n) || 0;
}

module.exports = {
  approvedSummary, verifyProductPurchase, verifyServiceVisit, alreadyReviewed, createReview,
  listReviews, moderateReview, countPendingReviews,
};

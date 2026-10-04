'use strict';
// Ciclo de vida del pedido de tienda:
//   /pagar      → reserva stock (atómico) + crea pedido 'pending' + enlace de pago
//   pago OK     → confirmPaid(): una sola vez, sin importar cuántas veces llegue
//                 la confirmación (retorno + webhook): cupón, puntos, cita de
//                 instalación, correos y estado logístico 'confirmado'
//   pago KO     → markFailed(): libera la reserva una sola vez
//   vencido     → releaseExpired() (cron): libera reservas de pedidos sin pagar

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  db, updateOrderStatus, getOrderById, claimStockDecrement, claimStockRelease, claimOrderPoints,
  setOrderAppointment, createAppointment, addUserScore, getExpiredReservedOrders,
} = require('../../db');
const repo = require('./repo');
const { loadCatalog } = require('../catalog');
const { redeemCoupon } = require('./coupons');
const { getShopConfig, pointsForPurchase } = require('./config');
const { sendOrderEmails } = require('./emails');

// Código corto y legible para el cliente (sin 0/O/1/I para evitar confusiones).
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function makePublicCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `GZ-${s}`;
}

// Líneas que se guardan en el pedido. `id` = id del producto (compatibilidad
// con el admin y con pedidos antiguos).
function orderItemsFromCart(priced) {
  return priced.lines.map((l) => ({
    id: l.productId,
    productId: l.productId,
    variantId: l.variantId,
    key: l.key,
    name: l.variantLabel ? `${l.name} (${l.variantLabel})` : l.name,
    slug: l.slug,
    qty: l.qty,
    unitBase: l.unitBase,
    unitPrice: l.unitPrice,
    total: l.lineTotal,
    install: l.install,
    installPrice: l.installPrice,
  }));
}

const stockLines = (items) => items.map((i) => ({ productId: i.productId || i.id, variantId: i.variantId || null, qty: i.qty }));

// Reclama la confirmación: solo una llamada pasa de 'nuevo' a 'confirmado'.
async function claimConfirmation(id) {
  const r = await db.execute({
    sql: "UPDATE orders SET fulfillment_status = 'confirmado' WHERE id = ? AND fulfillment_status = 'nuevo' AND status = 'paid'",
    args: [id],
  });
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

async function confirmPaid(orderId, paymentRef, { mailer } = {}) {
  await updateOrderStatus(orderId, 'paid', paymentRef);
  let order = await getOrderById(orderId);
  if (!order || order.status !== 'paid') return null;

  // Pedidos creados antes de la reserva en /pagar: se descuenta ahora.
  if (!order.stockReserved && await claimStockDecrement(orderId)) {
    await repo.forceDecrementStock(stockLines(order.items));
  }
  if (!await claimConfirmation(orderId)) return order; // ya confirmado antes

  if (order.couponCode) await redeemCoupon(order.couponCode).catch((e) => console.error('[Orders] cupón:', e.message));

  if (order.userId) {
    const pts = pointsForPurchase(order.total);
    if (pts > 0 && await claimOrderPoints(orderId, pts)) {
      await addUserScore(order.userId, pts, 'compra', `Compra en la tienda ${order.publicCode || ''}`.trim())
        .catch((e) => console.error('[Orders] puntos:', e.message));
    }
  }

  if (order.installation && order.installation.date && !order.appointmentId) {
    const cfg = getShopConfig();
    const names = order.items.filter((i) => i.install).map((i) => i.name).join(', ');
    const apptId = uuidv4();
    await createAppointment({
      id: apptId,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      service: `${cfg.install.serviceName}: ${names}`.slice(0, 200),
      date: order.installation.date,
      time: order.installation.time || null,
      plate: order.installation.plate || null,
      status: 'pendiente',
    });
    await setOrderAppointment(orderId, apptId);
  }

  order = await getOrderById(orderId);
  await loadCatalog().catch(() => {}); // refleja el stock nuevo en esta instancia
  (mailer || sendOrderEmails)(order).catch((e) => console.error('[Orders] correos:', e.message));
  return order;
}

async function markFailed(orderId, paymentRef, status = 'failed') {
  await updateOrderStatus(orderId, status, paymentRef);
  if (status !== 'failed') return;
  const order = await getOrderById(orderId);
  if (order && order.status !== 'paid' && await claimStockRelease(orderId)) {
    await repo.releaseStock(stockLines(order.items));
    await loadCatalog().catch(() => {});
  }
}

// Libera reservas de pedidos sin pagar con más de `minutes` minutos.
async function releaseExpired(minutes = 45) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const orders = await getExpiredReservedOrders(cutoff);
  let released = 0;
  for (const o of orders) {
    if (await claimStockRelease(o.id)) {
      await repo.releaseStock(stockLines(o.items));
      if (o.status === 'pending') await updateOrderStatus(o.id, 'failed', null);
      released++;
    }
  }
  if (released) await loadCatalog().catch(() => {});
  return released;
}

module.exports = { makePublicCode, orderItemsFromCart, stockLines, confirmPaid, markFailed, releaseExpired };

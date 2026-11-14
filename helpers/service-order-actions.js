'use strict';
// Cambio de estado de una orden de servicio desde el panel admin. Vive aquí y
// no en la ruta para que el formulario del detalle y el asistente con IA
// (helpers/panel-ia) apliquen exactamente la misma política: proforma
// automática al pasar a 'trabajo_completo', anulación de la proforma al
// devolver el estado, y bloqueo cuando la factura ya está cerrada.
//
// 'entregado' nunca pasa por aquí: solo lo marca el flujo de entrega, que
// cierra la factura con el parqueadero.

const {
  applyStatusPolicy, updateServiceOrder, convertServiceOrderToInvoice,
} = require('../db');
const { ALLOWED_STATUS } = require('./service-order-status');

function nowCOT() {
  const cot = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return cot.toISOString().replace('Z', '-05:00');
}

/**
 * Aplica `newStatus` a `order` junto con `extra` (otros campos del formulario).
 * Devuelve { ok: true, status, proforma, invoiceDetached } o { ok: false, msg }.
 */
async function cambiarEstadoOrden(order, newStatus, actor, extra = {}) {
  if (newStatus === 'entregado') {
    return { ok: false, msg: 'Para entregar la moto usa el formulario de entrega (cierra la factura con el parqueadero).' };
  }
  // Solo estados alcanzables desde el panel; 'facturado' se acepta únicamente
  // como no-op cuando la orden ya está en ese estado.
  if (!ALLOWED_STATUS.includes(newStatus) && newStatus !== order.status) {
    return { ok: false, msg: 'Estado de orden inválido.' };
  }
  const policy = await applyStatusPolicy(order, newStatus, actor);
  if (!policy.allowed) return { ok: false, msg: policy.msg };

  const updates = { ...extra };
  if (policy.status) updates.status = policy.status;
  const entraCompleto = policy.status === 'trabajo_completo' && order.status !== 'trabajo_completo';
  if (policy.status === 'trabajo_completo' && !order.trabajoCompletoAt) {
    updates.trabajoCompletoAt = nowCOT();
  }
  // El admin que toca la orden la da por revisada: limpia el aviso del taller.
  if (order.pendingReview) updates.pendingReview = false;
  await updateServiceOrder(order.id, updates, actor);

  // Al quedar lista la moto se emite la factura proforma automáticamente: es
  // el único momento en que se sabe con certeza si aplica parqueadero, así que
  // el total definitivo se cierra recién al entregar la moto.
  let proforma = false;
  const invoiceId = policy.invoiceDetached ? null : order.invoiceId;
  if (entraCompleto && !invoiceId) {
    try {
      await convertServiceOrderToInvoice({ ...order, status: 'trabajo_completo', invoiceId: null }, {}, actor);
      proforma = true;
    } catch (e) {
      console.error('Auto-facturación proforma falló:', e.message);
    }
  }
  return { ok: true, status: policy.status || order.status, proforma, invoiceDetached: !!policy.invoiceDetached };
}

module.exports = { cambiarEstadoOrden, nowCOT };

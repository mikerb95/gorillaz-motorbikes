'use strict';
// Correos de la tienda: confirmación al cliente, aviso al taller y recordatorio
// de carrito. Todo dato del cliente o del catálogo se escapa antes de ir al HTML.

const { resendClient } = require('../../config');
const { fmtCOP } = require('../money');
const { abs } = require('../seo');
const { waLink, messages } = require('../whatsapp');
const { METHOD_LABELS } = require('./delivery');
const { getBusiness, fullAddress } = require('../business');

const FROM = 'Gorillaz Motorbikes <tienda@gorillazmotorbikes.com>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mailEnabled() {
  const k = process.env.RESEND_API_KEY;
  return !!k && k !== 're_dummy_key_to_prevent_crash_123';
}

function itemsTable(order) {
  const rows = order.items.map((i) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}${i.install ? '<br><small style="color:#666">Con instalación en el taller</small>' : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${esc(i.qty)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${esc(fmtCOP(i.total))}</td>
    </tr>`).join('');
  const extra = [];
  for (const d of order.discounts || []) extra.push([`Descuento: ${d.label}`, `- ${fmtCOP(d.amount)}`]);
  if (order.deliveryFee) extra.push(['Entrega', fmtCOP(order.deliveryFee)]);
  const inst = order.items.reduce((s, i) => s + (i.install && typeof i.installPrice === 'number' ? i.installPrice * i.qty : 0), 0);
  if (inst) extra.push(['Instalación', fmtCOP(inst)]);
  const extraRows = extra.map(([a, b]) => `<tr><td colspan="2" style="padding:6px 8px;text-align:right">${esc(a)}</td><td style="padding:6px 8px;text-align:right">${esc(b)}</td></tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Producto</th><th style="padding:8px">Cant.</th><th style="padding:8px;text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${extraRows}<tr><td colspan="2" style="padding:8px;text-align:right"><strong>Total pagado</strong></td><td style="padding:8px;text-align:right"><strong>${esc(fmtCOP(order.total))}</strong></td></tr></tfoot>
  </table>`;
}

function deliveryBlock(order) {
  const biz = getBusiness();
  if (order.deliveryMethod === 'pickup' || !order.deliveryMethod) {
    return `<p><strong>Entrega:</strong> recoges en el taller, ${esc(fullAddress(biz))}. Te avisamos cuando esté listo.</p>`;
  }
  return `<p><strong>Entrega:</strong> ${esc(METHOD_LABELS[order.deliveryMethod] || '')}<br>${esc(order.customerAddress)}, ${esc(order.customerCity)}</p>`;
}

function installBlock(order) {
  if (!order.installation || !order.installation.date) return '';
  return `<p><strong>Instalación en el taller:</strong> ${esc(order.installation.date)}${order.installation.time ? ` a las ${esc(order.installation.time)}` : ''}${order.installation.plate ? ` (placa ${esc(order.installation.plate)})` : ''}. Te confirmamos la cita por WhatsApp.</p>`;
}

async function sendOrderEmails(order) {
  if (!mailEnabled() || !order) return;
  const code = order.publicCode || order.id.slice(0, 8).toUpperCase();
  const trackUrl = abs('/tienda/pedido');
  const wa = waLink(messages.order({ code, url: trackUrl }));

  const clientHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#F25C05">Gracias por tu compra, ${esc(order.customerName)}</h2>
      <p>Recibimos tu pago. Tu número de pedido es <strong>${esc(code)}</strong>.</p>
      ${itemsTable(order)}
      ${deliveryBlock(order)}
      ${installBlock(order)}
      <p>Consulta el estado en <a href="${esc(trackUrl)}">${esc(trackUrl)}</a> con tu número de pedido y los últimos 4 dígitos de tu teléfono.</p>
      <p>¿Dudas? <a href="${esc(wa)}">Escríbenos por WhatsApp</a>.</p>
      <p style="color:#888;font-size:13px">Equipo Gorillaz Motorbikes</p>
    </div>`;

  const storeHtml = `<div style="font-family:sans-serif">
      <h2>Nuevo pedido ${esc(code)}</h2>
      <p><strong>Cliente:</strong> ${esc(order.customerName)} &lt;${esc(order.customerEmail)}&gt; · ${esc(order.customerPhone)}</p>
      ${deliveryBlock(order)}
      ${installBlock(order)}
      ${order.notes ? `<p><strong>Notas:</strong> ${esc(order.notes)}</p>` : ''}
      ${itemsTable(order)}
    </div>`;

  const storeEmail = process.env.ORDERS_EMAIL || process.env.BOOKING_EMAIL || 'booking@gorillazmotorbikes.com';
  await Promise.allSettled([
    resendClient.emails.send({ from: FROM, to: order.customerEmail, subject: `Pedido ${code} confirmado | Gorillaz Motorbikes`, html: clientHtml }),
    resendClient.emails.send({ from: FROM, to: storeEmail, subject: `Nuevo pedido ${code}: ${fmtCOP(order.total)}`, html: storeHtml }),
  ]);
}

async function sendCartReminder({ email, name, lines, total }) {
  if (!mailEnabled()) return false;
  const rows = lines.map((l) => `<li>${esc(l.qty)} x <a href="${esc(abs(`/tienda/${l.slug}`))}">${esc(l.name)}</a></li>`).join('');
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#F25C05">${esc(name || 'Hola')}, tu carrito te espera</h2>
      <p>Guardamos estos productos por ti:</p><ul>${rows}</ul>
      <p>Total: <strong>${esc(fmtCOP(total))}</strong></p>
      <p><a href="${esc(abs('/carrito'))}" style="background:#F25C05;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Terminar mi compra</a></p>
      <p style="color:#888;font-size:13px">Si ya no te interesa, ignora este correo. No te volveremos a escribir por este carrito.</p>
    </div>`;
  await resendClient.emails.send({ from: FROM, to: email, subject: 'Tu carrito en Gorillaz Motorbikes', html });
  return true;
}

module.exports = { esc, sendOrderEmails, sendCartReminder, mailEnabled };

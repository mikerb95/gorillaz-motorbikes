'use strict';
// Enlaces de WhatsApp con mensaje prellenado según el contexto. El número sale
// de la configuración del negocio y siempre lleva el indicativo de Colombia.

const { getBusiness } = require('./business');
const { fmtCOP } = require('./money');

// 3213204299 → 573213204299. Acepta el número con o sin +57 y con espacios.
function waNumber(raw = getBusiness().whatsapp) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

// Escribirle al taller.
function waLink(text, number) {
  const n = waNumber(number);
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// Compartir con cualquier contacto (sin número destino).
function waShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Mensajes por contexto. `url` debe ser absoluta para que el chat la enlace.
const messages = {
  product: ({ name, price, url }) => `Hola, me interesa este producto: ${name} (${fmtCOP(price)}). ${url}`,
  productShare: ({ name, price, url }) => `${name} a ${fmtCOP(price)} en Gorillaz Motorbikes: ${url}`,
  install: ({ name, url }) => `Hola, quiero instalar en el taller: ${name}. ¿Qué disponibilidad tienen? ${url}`,
  service: ({ name, url }) => `Hola, quiero información sobre el servicio de ${name}. ${url}`,
  order: ({ code, url }) => `Hola, hice el pedido ${code} en la tienda. ${url}`,
  cart: ({ lines, total }) => `Hola, tengo estas preguntas sobre mi carrito: ${lines.map((l) => `${l.qty} x ${l.name}`).join(', ')} (total ${fmtCOP(total)}).`,
  general: () => 'Hola, vengo del sitio web de Gorillaz Motorbikes.',
  shop: () => 'Hola, tengo una pregunta sobre la tienda.',
  bike: ({ model, url }) => `Hola, busco accesorios y repuestos para mi ${model}. ${url}`,
};

module.exports = { waNumber, waLink, waShareLink, messages };

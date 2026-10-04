'use strict';
// Estado de una moto desde el chat del asesor. La IA nunca ve la placa, el
// celular ni la orden: solo llama a consultar_orden, el navegador muestra un
// formulario y la consulta la responde esta función (POST /asesor/orden).
//
// La misma búsqueda (ordenDelCliente) la usa la página /mi-orden. Quien llama
// responde igual cuando no hay orden y cuando el celular no coincide, para que
// el formulario no sirva para averiguar qué placas tienen orden.

const ESTADOS = {
  pendiente: 'Pendiente',
  ingreso_taller: 'Ingreso al taller',
  trabajo_en_curso: 'Trabajo en curso',
  en_pausa: 'En pausa',
  en_proceso: 'En proceso',
  trabajo_completo: 'Listo para recoger',
  // 'facturado' es la proforma al terminar: la moto sigue en el taller.
  facturado: 'Listo para recoger',
  entregado: 'Entregado',
};
const ACTIVOS = new Set(['pendiente', 'ingreso_taller', 'trabajo_en_curso', 'en_pausa', 'en_proceso', 'trabajo_completo', 'facturado']);

// Placas de moto en Colombia: ABC12D; las antiguas, ABC12. Exigir el formato
// completo evita que "AB" encuentre la orden de cualquier placa que lo
// contenga (la búsqueda en la base es por subcadena).
const PLACA = /^[A-Z]{3}\d{2}[A-Z0-9]?$/;

class DatosInvalidos extends Error {}

function normalizarPlaca(placa) {
  return String(placa || '').toUpperCase().replace(/[\s-]/g, '');
}

function ultimos4(telefono) {
  const d = String(telefono || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}

/**
 * La orden de ese cliente: la activa más reciente de esa placa cuyo celular
 * termina en esos 4 dígitos (si todas están cerradas, la última), o null.
 * Lanza DatosInvalidos si la placa o los dígitos no tienen forma válida.
 * La usan el chat y la página /mi-orden.
 */
async function ordenDelCliente(entrada, ordenesPorPlaca) {
  const placa = normalizarPlaca(entrada && entrada.placa);
  const digitos = String((entrada && entrada.digitos) || '').trim();
  if (!PLACA.test(placa)) throw new DatosInvalidos('placa');
  if (!/^\d{4}$/.test(digitos)) throw new DatosInvalidos('digitos');

  // Primero el celular: si la moto cambió de dueño, cada uno ve solo lo suyo.
  const ordenes = (await ordenesPorPlaca(placa)).filter((o) => ultimos4(o.clientPhone) === digitos);
  if (!ordenes.length) return null;
  const recientes = [...ordenes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return recientes.find((x) => ACTIVOS.has(x.status)) || recientes[0];
}

/**
 * Resumen público de la orden para el chat, o null si no hay una que coincida.
 * `deps` = { ordenesPorPlaca(placa), parqueadero(orden) }.
 */
async function buscarOrden(entrada, deps) {
  const o = await ordenDelCliente(entrada, deps.ordenesPorPlaca);
  if (!o) return null;

  const p = deps.parqueadero(o) || { aplica: false };
  return {
    orden: o.label,
    estado: ESTADOS[o.status] || o.status,
    listo: o.status === 'trabajo_completo' || o.status === 'facturado',
    entregado: o.status === 'entregado',
    moto: o.motorcycle || null,
    comentarios: o.notes || null,
    trabajos: (o.items || []).map((it) => ({ nombre: it.name || it.description || 'Servicio', cantidad: Number(it.qty) || 1 })),
    total: Number(o.total) || 0,
    parqueadero: p.aplica ? { dias: p.diasCobro, valor: p.totalParq } : null,
    diasGratisRestantes: !p.aplica && o.trabajoCompletoAt && p.diasRestantes > 0 ? p.diasRestantes : null,
  };
}

module.exports = { DatosInvalidos, buscarOrden, ordenDelCliente, normalizarPlaca };

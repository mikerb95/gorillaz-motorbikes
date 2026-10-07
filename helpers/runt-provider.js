'use strict';
// Consulta del SOAT y la tecnomecánica por placa + documento a través de un
// proveedor de datos con API (sin captcha). Se activa con la clave del
// proveedor en las variables de entorno; sin clave, providerName() es null y
// el garaje cae al botón con captcha (helpers/runt.js).
//
//   VERIFIK_API_TOKEN  → Verifik   (GET  https://api.verifik.co/v2/co/runt/vehiculo)
//   PLACAPI_API_KEY    → PlacApi   (POST https://placapi.com/api/consulta)
//   RUNT_PROVIDER      → opcional, 'verifik' | 'placapi' si están las dos claves
//
// Resultado normalizado:
//   { status: 'ok',       soat: 'AAAA-MM-DD' | null, tecno: 'AAAA-MM-DD' | null }
//   { status: 'notfound', reason }  el documento no es del propietario o no hay registro (no reintentar)
//   { status: 'error',    reason }  falla del proveedor o de la fuente (reintentar más tarde)

const { normalizarFecha } = require('./runt');

const TIMEOUT_MS = 20000;

function providerName() {
  const has = { verifik: !!process.env.VERIFIK_API_TOKEN, placapi: !!process.env.PLACAPI_API_KEY };
  const wanted = String(process.env.RUNT_PROVIDER || '').toLowerCase();
  if (has[wanted]) return wanted;
  return has.verifik ? 'verifik' : has.placapi ? 'placapi' : null;
}

// La vigencia más lejana de un histórico (el proveedor puede traer pólizas viejas).
function latest(dates) {
  return dates.map(normalizarFecha).filter(Boolean).sort().pop() || null;
}

async function call(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function viaVerifik({ plate, docType, docNumber }) {
  const qs = new URLSearchParams({ documentType: docType, documentNumber: docNumber, plate });
  const { status, body } = await call(`https://api.verifik.co/v2/co/runt/vehiculo?${qs}`, {
    headers: { authorization: `Bearer ${process.env.VERIFIK_API_TOKEN}`, accept: 'application/json' },
  });
  if (status === 404) return { status: 'notfound', reason: body.code || body.message || 'sin_registro' };
  if (status !== 200) return { status: 'error', reason: `verifik HTTP ${status} ${body.code || body.message || ''}`.trim() };
  const d = body.data || body;
  return {
    status: 'ok',
    soat: latest([d.soat && d.soat.dueDate]),
    tecno: latest([d.techReview && d.techReview.dueDate]),
  };
}

async function viaPlacapi({ plate, docType, docNumber }) {
  const { status, body } = await call('https://placapi.com/api/consulta', {
    method: 'POST',
    headers: { 'x-api-key': process.env.PLACAPI_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ placa: plate, docType, docNumber }),
  });
  if (status === 404) return { status: 'notfound', reason: body.code || 'sin_registro' };
  if (status !== 200) return { status: 'error', reason: `placapi HTTP ${status} ${body.code || ''}`.trim() };
  const d = body.data || {};
  return {
    status: 'ok',
    soat: latest((d.soat || []).map(p => p.fechaVencimiento)),
    tecno: latest((d.tecnoMecanica || []).map(r => r.fechaVencimiento)),
  };
}

async function consultarVehiculo({ plate, docNumber, docType = 'CC' }) {
  const name = providerName();
  if (!name) return { status: 'error', reason: 'sin_proveedor' };
  const args = { plate: String(plate).toUpperCase().replace(/\s/g, ''), docType, docNumber: String(docNumber).replace(/\D/g, '') };
  try {
    return await (name === 'verifik' ? viaVerifik(args) : viaPlacapi(args));
  } catch (e) {
    return { status: 'error', reason: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

module.exports = { providerName, consultarVehiculo };

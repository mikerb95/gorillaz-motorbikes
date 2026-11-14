'use strict';
// Guardia de cifras del asistente del panel. Reutiliza la del asesor público
// (helpers/asesor/guardia.js: solo mira cantidades MARCADAS como dinero) y
// arma la lista de cifras permitidas desde la propia conversación: todo número
// que haya devuelto una herramienta y todo lo que escribió la persona ("pon la
// mano de obra en 90 mil" vuelve permitido el 90.000).
//
// Módulo PURO.

const { extraerCifras, verificarCifras } = require('../asesor/guardia');
const { PREFIJO_GUARDIA, PREFIJO_BLOQUEO } = require('./turnos');

// Los avisos de la propia guardia citan las cifras inventadas: no cuentan.
const esAvisoInterno = (t) => t.startsWith(PREFIJO_GUARDIA) || t.startsWith(PREFIJO_BLOQUEO);

function numerosDe(texto) {
  const out = [];
  for (const m of String(texto).matchAll(/\d{1,3}(?:[.,]\d{3})+|\d+/g)) {
    const n = Number(m[0].replace(/[.,]/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  for (const c of extraerCifras(texto)) out.push(c.valor);
  // "90 mil" o "1,5 millones" sin signo de pesos: la guardia del asesor los
  // ignora por ambiguos, pero aquí solo sirven para PERMITIR una cifra.
  for (const m of String(texto).matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(mil|millones|millón|millon|k)\b/gi)) {
    const base = Number(m[1].replace(',', '.'));
    const factor = /^mil$|^k$/i.test(m[2]) ? 1e3 : 1e6;
    if (Number.isFinite(base)) out.push(Math.round(base * factor));
  }
  return out;
}

/** Todas las cifras que la respuesta puede citar: salidas de herramientas y texto de la persona. */
function cifrasPermitidas(mensajes) {
  const permitidas = new Set();
  for (const m of mensajes || []) {
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') {
      numerosDe(m.content).forEach((n) => permitidas.add(n));
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text' && b.text && !esAvisoInterno(b.text)) numerosDe(b.text).forEach((n) => permitidas.add(n));
      if (b.type === 'tool_result' && typeof b.content === 'string') numerosDe(b.content).forEach((n) => permitidas.add(n));
    }
  }
  return [...permitidas];
}

function verificarRespuesta(texto, mensajes) {
  return verificarCifras(texto, cifrasPermitidas(mensajes));
}

module.exports = { cifrasPermitidas, verificarRespuesta };

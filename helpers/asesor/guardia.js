'use strict';
// Guardia de cifras del asesor con IA (copia en CommonJS de la del asesor de
// codebymike.net). Toda cantidad de dinero que el asesor escriba tiene que
// salir de lo publicado (cursos) o de una búsqueda en la tienda de esta misma
// conversación. Si aparece una que no, la respuesta se rechaza y el modelo la
// rehace con la lista de cifras inventadas a la vista.
//
// Solo se miran cantidades MARCADAS como dinero ($, US$, COP, "pesos",
// "millones", "mil" con moneda): "20 personas", "8 horas", "50 %" o "15 días"
// no son precio y no deben disparar la guardia. Se aceptan las dos
// convenciones de separadores (1.500.000 y 1,5 millones; 1,500 y 1.5k).
//
// Módulo PURO.

const MULTIPLICADOR = {
  millones: 1e6,
  'millón': 1e6,
  millon: 1e6,
  m: 1e6,
  mil: 1e3,
  k: 1e3,
};

// $ o US$ delante, o COP/USD/pesos/millones/mil/M/k detrás (al menos una marca).
const PATRON =
  /(US\$|COP\s?\$|\$)?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)(?:\s?(millones|millón|millon|mil|M|k)\b)?(?:\s?(COP|USD|pesos|dólares|dolares))?/gi;

/** Lee un número con separadores de miles o un decimal corto. Devuelve [valor, decimales]. */
function leerNumero(crudo) {
  if (/^\d{1,3}([.,]\d{3})+$/.test(crudo)) return [Number(crudo.replace(/[.,]/g, '')), 0];
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(crudo);
  if (!m) return [NaN, 0];
  const dec = m[2] || '';
  return [Number(`${m[1]}.${dec || '0'}`), dec.length];
}

function extraerCifras(texto) {
  const out = [];
  for (const m of String(texto).matchAll(PATRON)) {
    const [entero, prefijo, numero, mult, sufijo] = m;
    if (!prefijo && !mult && !sufijo) continue;
    // "mil" y "M" sueltos sin moneda son ambiguos ("2 mil kilómetros"): solo
    // cuentan si además hay una marca de dinero.
    if (!prefijo && !sufijo && mult && !/^millon|^millón/i.test(mult)) continue;
    const [base, decimales] = leerNumero(numero);
    if (!Number.isFinite(base)) continue;
    const factor = mult ? MULTIPLICADOR[mult.toLowerCase()] || 1 : 1;
    const valor = Math.round(base * factor);
    // La precisión escrita da el margen ("1,5 millones" cubre ±50.000), pero
    // nunca más del 3 %: "5 millones" no puede pasar por un precio de 4,5.
    const tolerancia = mult ? Math.min(factor / 10 ** decimales / 2, valor * 0.03) : 0;
    out.push({ texto: entero.trim(), valor, tolerancia });
  }
  return out;
}

/** Compara las cifras de dinero del texto con las permitidas. */
function verificarCifras(texto, permitidas) {
  const inventadas = extraerCifras(texto).filter(
    (c) => !permitidas.some((p) => Math.abs(p - c.valor) <= c.tolerancia)
  );
  return { ok: inventadas.length === 0, inventadas };
}

module.exports = { extraerCifras, verificarCifras };

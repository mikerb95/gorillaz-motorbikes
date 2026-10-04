'use strict';
// Costo de una pregunta al asesor, con el `usage` de cada respuesta de la API.
// Alimenta el tope de gasto diario (presupuesto.js). La cifra que manda es la
// de la consola de Claude; esto es la estimación para no pasarse.
//
// Módulo PURO.

const MODELO = 'claude-haiku-4-5-20251001';

/** USD por millón de tokens (Haiku 4.5). Escribir en caché cuesta 1.25x la entrada. */
const TARIFA = { entrada: 1, salida: 5, cacheLectura: 0.1, cacheEscritura: 1.25 };

const USO_CERO = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 };

function sumarUso(a, u) {
  return {
    entrada: a.entrada + (u?.input_tokens || 0),
    salida: a.salida + (u?.output_tokens || 0),
    cacheLectura: a.cacheLectura + (u?.cache_read_input_tokens || 0),
    cacheEscritura: a.cacheEscritura + (u?.cache_creation_input_tokens || 0),
  };
}

function costoUsd(u) {
  const m = 1_000_000;
  return (
    (u.entrada * TARIFA.entrada) / m +
    (u.salida * TARIFA.salida) / m +
    (u.cacheLectura * TARIFA.cacheLectura) / m +
    (u.cacheEscritura * TARIFA.cacheEscritura) / m
  );
}

module.exports = { MODELO, TARIFA, USO_CERO, sumarUso, costoUsd };

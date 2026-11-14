'use strict';
// Costo de cada llamada al modelo del asistente del panel, con el `usage` que
// devuelve la API. Alimenta los topes del día (consumo.js). La cifra que manda
// es la de la consola de Claude; esto es la estimación para no pasarse.
//
// Módulo PURO.

const MODELO = 'claude-sonnet-5-5';

/**
 * USD por millón de tokens de Claude Sonnet 5.5 (tarifa vista el 2026-11-12).
 * Escribir en caché (5 min) cuesta 1,25 veces la entrada. Si la tarifa cambia,
 * se actualiza aquí y se anota la fecha.
 */
const TARIFA = { entrada: 2, salida: 10, cacheLectura: 0.1, cacheEscritura: 2.5 };
const TARIFA_FECHA = '2026-11-12';

const USO_CERO = Object.freeze({ entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 });

function usoDe(u) {
  return {
    entrada: u?.input_tokens || 0,
    salida: u?.output_tokens || 0,
    cacheLectura: u?.cache_read_input_tokens || 0,
    cacheEscritura: u?.cache_creation_input_tokens || 0,
  };
}

function sumarUso(a, u) {
  const b = usoDe(u);
  return {
    entrada: a.entrada + b.entrada,
    salida: a.salida + b.salida,
    cacheLectura: a.cacheLectura + b.cacheLectura,
    cacheEscritura: a.cacheEscritura + b.cacheEscritura,
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

module.exports = { MODELO, TARIFA, TARIFA_FECHA, USO_CERO, usoDe, sumarUso, costoUsd };

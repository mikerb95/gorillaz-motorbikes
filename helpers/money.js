'use strict';
// Formato único de precios del sitio: $ 150.000 COP.

function fmtCOP(n) {
  const v = Math.round(Number(n) || 0);
  return `$ ${v.toLocaleString('es-CO')} COP`;
}

// Variante corta para espacios estrechos (minicarrito, chips): $ 150.000
function fmtPesos(n) {
  return `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
}

module.exports = { fmtCOP, fmtPesos };

'use strict';
// Slugs de la tienda: texto descriptivo en minúsculas, sin tildes ni símbolos.
// Algunos segmentos están reservados porque /tienda/{slug} convive con
// /tienda/c/{categoria}, /tienda/moto/{modelo} y /tienda/combos.

const RESERVED = new Set(['c', 'moto', 'combos', 'combo', 'buscar', 'carrito', 'checkout', 'pedido']);

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/g, '');
}

// Devuelve un slug libre: si `base` ya está tomado (o reservado) agrega -2, -3…
function uniqueSlug(base, taken) {
  const root = slugify(base) || 'producto';
  const isTaken = (s) => RESERVED.has(s) || (taken instanceof Set ? taken.has(s) : taken(s));
  if (!isTaken(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const s = `${root}-${i}`;
    if (!isTaken(s)) return s;
  }
  return `${root}-${Date.now()}`;
}

module.exports = { slugify, uniqueSlug, RESERVED };
